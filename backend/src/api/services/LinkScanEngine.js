'use strict';
/**
 * LinkScanEngine — محرك البحث التلقائي عن روابط الدعوة
 *
 * المهام:
 * - فحص جميع محادثات ومجموعات الحساب المحدد
 * - استخراج روابط الدعوة (واتساب / تيليجرام / قنوات)
 * - حفظها في قاعدة البيانات مع إزالة المكرر
 * - إرسال تحديثات لحظية عبر Socket.IO
 * - دعم الإيقاف والاستكمال
 */

const WhatsAppManager = require('../../bot/WhatsAppManager');
const DatabaseManager = require('../../database/DatabaseManager');
const LinkExtractorService = require('./LinkExtractorService');
const crypto = require('crypto');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function canonicalizeUrl(value) {
  const match = String(value || '').trim().match(/https?:\/\/[^\s<>()]+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0].replace(/[),.;!?؟]+$/g, ''));
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) url.searchParams.delete(key);
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}
function linkHash(url) { return crypto.createHash('sha256').update(String(url || '')).digest('hex'); }
function classifyScanError(error) {
  const message = String(error?.message || error || 'خطأ غير معروف');
  const lower = message.toLowerCase();
  const retryable = /timeout|timed out|network|socket|econn|temporar|rate.?limit|flood|429|502|503|504|disconnect/.test(lower);
  return { type: retryable ? 'RETRYABLE' : 'NON_RETRYABLE', message, source: error?.code || (retryable ? 'transport' : 'scan') };
}

// نمط روابط الدعوة
const INVITE_PATTERNS = [
  /https?:\/\/chat\.whatsapp\.com\/([A-Za-z0-9_-]{10,})/gi,
  /https?:\/\/wa\.me\/([A-Za-z0-9_-]{10,})/gi,
  /https?:\/\/t\.me\/([A-Za-z0-9_+]{3,})/gi,
  /https?:\/\/telegram\.me\/([A-Za-z0-9_+]{3,})/gi,
  /https?:\/\/t\.me\/joinchat\/([A-Za-z0-9_-]{10,})/gi,
  /https?:\/\/t\.me\/\+([A-Za-z0-9_-]{10,})/gi,
];

function extractLinksFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const found = new Set();
  for (const pattern of INVITE_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      found.add(m[0].trim());
    }
  }
  return [...found];
}

function detectLinkType(url) {
  if (/chat\.whatsapp\.com/.test(url)) return 'whatsapp_group';
  if (/wa\.me/.test(url)) return 'whatsapp_group';
  if (/t\.me\/joinchat|t\.me\/\+/.test(url)) return 'telegram_group';
  if (/t\.me\//.test(url)) return 'telegram';
  if (/telegram\.me/.test(url)) return 'telegram';
  return 'other';
}

class LinkScanEngine {
  constructor() {
    // حالة كل مهمة فحص: accountId → ScanJob
    this._jobs = new Map();
    // Socket.IO instance (يُضبط من الخارج)
    this._io = null;
  }

  setSocketIO(io) {
    this._io = io;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  الحصول على حالة مهمة
  // ══════════════════════════════════════════════════════════════════════════
  getJob(accountId) {
    return this._publicJob(this._jobs.get(accountId)) || { id: null, status: 'idle', progress: 0, total: 0, scanned: 0, found: 0, duplicates: 0, invalid: 0, review: 0, currentChat: null, startedAt: null, finishedAt: null, lastError: null, log: [] };
  }

  getAllJobs() {
    const result = {};
    for (const [id, job] of this._jobs.entries()) result[id] = this._publicJob(job);
    return result;
  }

  async loadJob(accountId) {
    const active = this._jobs.get(accountId); if (active) return this._publicJob(active);
    try {
      const db = await DatabaseManager.getAccountDB(accountId); await this._ensureTables(db);
      const row = await db.get(`SELECT * FROM link_scan_jobs WHERE account_id=$1 ORDER BY updated_at DESC LIMIT 1`, [accountId]);
      if (!row) return this.getJob(accountId);
      const job = { id: row.id, accountIds: row.account_ids || [accountId], status: row.status, progress: row.total ? Math.round((Number(row.scanned||0)/Number(row.total))*100) : 0, total:Number(row.total||0), scanned:Number(row.scanned||0), found:Number(row.found||0), duplicates:Number(row.duplicates||0), invalid:Number(row.invalid||0), review:Number(row.review||0), retries:Number(row.retries||0), maxRetries:Number(row.max_retries||3), currentChat:row.current_chat, startedAt:row.started_at, finishedAt:row.finished_at, lastActivityAt:row.last_activity_at, lastError:row.last_error, errorType:row.error_type, checkpointIndex:Number(row.checkpoint_index||0), source:row.source, log:[], _abort:false, _accountDB:db };
      this._jobs.set(accountId, job); return this._publicJob(job);
    } catch { return this.getJob(accountId); }
  }

  _publicJob(job) {
    if (!job) return null;
    const copy = { ...job };
    delete copy._abort; delete copy._accountDB; delete copy._persist;
    return copy;
  }

  async _persistJob(accountId, job) {
    try {
      const db = job._accountDB || await DatabaseManager.getAccountDB(accountId);
      await db.run(`INSERT INTO link_scan_jobs (id,account_id,account_ids,status,total,scanned,found,duplicates,invalid,review,retries,max_retries,current_chat,source,started_at,finished_at,last_activity_at,last_error,error_type,checkpoint_index,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),$17,$18,$19,NOW()) ON CONFLICT (id) DO UPDATE SET status=$4,total=$5,scanned=$6,found=$7,duplicates=$8,invalid=$9,review=$10,retries=$11,current_chat=$13,finished_at=$16,last_activity_at=NOW(),last_error=$17,error_type=$18,checkpoint_index=$19,updated_at=NOW()`, [job.id, accountId, JSON.stringify(job.accountIds || [accountId]), job.status, job.total || 0, job.scanned || 0, job.found || 0, job.duplicates || 0, job.invalid || 0, job.review || 0, job.retries || 0, job.maxRetries || 3, job.currentChat, job.source || 'whatsapp_live', job.startedAt, job.finishedAt, job.lastError || null, job.errorType || null, job.checkpointIndex || 0]);
    } catch (persistError) { console.warn(`[LinkScanEngine] job persistence failed: ${persistError.message}`); }
  }

  async _recordEvent(accountId, job, eventType, message, details = {}) {
    try { const db = job._accountDB || await DatabaseManager.getAccountDB(accountId); await db.run(`INSERT INTO link_scan_events (job_id,account_id,event_type,message,details) VALUES ($1,$2,$3,$4,$5)`, [job.id, accountId, eventType, message, JSON.stringify(details)]); } catch (eventError) { console.warn(`[LinkScanEngine] event persistence failed: ${eventError.message}`); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  بدء مهمة الفحص
  // ══════════════════════════════════════════════════════════════════════════
  async startScan(accountIds) {
    if (!Array.isArray(accountIds)) accountIds = [accountIds];
    const started = []; const skipped = []; const rejected = [];
    for (const accountId of [...new Set(accountIds.filter(Boolean).map(String))]) {
      const existing = this._jobs.get(accountId);
      if (existing && ['queued','running','waiting','retrying','processing'].includes(existing.status)) { skipped.push({ accountId, jobId: existing.id, reason: 'active_scan_exists' }); continue; }
      if (!WhatsAppManager.isReady(accountId)) { rejected.push({ accountId, reason: 'account_not_ready' }); continue; }
      const job = { id: `SCAN-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomUUID().slice(0,8)}`, accountIds: [accountId], status: 'queued', progress: 0, total: 0, scanned: 0, found: 0, duplicates: 0, invalid: 0, review: 0, retries: 0, maxRetries: 3, currentChat: null, startedAt: new Date().toISOString(), finishedAt: null, lastActivityAt: new Date().toISOString(), lastError: null, errorType: null, checkpointIndex: 0, source: 'whatsapp_live', log: [], _abort: false };
      try {
        const db = await DatabaseManager.getAccountDB(accountId); await this._ensureTables(db); job._accountDB = db;
        const activeDb = await db.get(`SELECT id FROM link_scan_jobs WHERE account_id=$1 AND status IN ('queued','running','waiting','retrying','processing') LIMIT 1`, [accountId]).catch(() => null);
        if (activeDb) { skipped.push({ accountId, jobId: activeDb.id, reason: 'active_scan_exists' }); continue; }
        this._jobs.set(accountId, job); await this._persistJob(accountId, job); await this._recordEvent(accountId, job, 'started', 'تم إنشاء مهمة فحص جديدة'); started.push({ accountId, jobId: job.id });
        this._runScan(accountId, job).catch(async err => { const info=classifyScanError(err); job.status='error'; job.errorType=info.type; job.lastError=info.message; job.finishedAt=new Date().toISOString(); job.log.push({ts:new Date().toISOString(),msg:`❌ ${info.message}`}); await this._persistJob(accountId,job); await this._recordEvent(accountId,job,'error',info.message,info); this._emit(accountId,job); });
      } catch (error) { rejected.push({ accountId, reason: error.message }); }
    }
    return { started, skipped, rejected };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  إيقاف مهمة الفحص
  // ══════════════════════════════════════════════════════════════════════════
  async stopScan(accountId) {
    const job = this._jobs.get(accountId); if (!job || !['queued','running','waiting','retrying','processing','paused'].includes(job.status)) return false;
    job._abort = true; job.status = 'stopped'; job.finishedAt = new Date().toISOString(); job.log.push({ ts: new Date().toISOString(), msg: '⏹ تم إيقاف الفحص بأمان وحفظ آخر نقطة' }); await this._persistJob(accountId, job); await this._recordEvent(accountId, job, 'stopped', 'تم إيقاف الفحص بأمان'); this._emit(accountId, job); return true;
  }

  async pauseScan(accountId) {
    const job=this._jobs.get(accountId); if(!job||!['running','processing','waiting'].includes(job.status)) return false; job.status='paused'; job.log.push({ts:new Date().toISOString(),msg:'⏸ تم إيقاف استقبال عناصر جديدة مؤقتاً'}); await this._persistJob(accountId,job); await this._recordEvent(accountId,job,'paused','تم إيقاف الفحص مؤقتاً'); this._emit(accountId,job); return true;
  }

  async resumeScan(accountId) {
    const job=this._jobs.get(accountId); if(!job||!['paused','stopped','error'].includes(job.status)) return false; job._abort=false; job.status='running'; job.finishedAt=null; job.log.push({ts:new Date().toISOString(),msg:'▶ تم استكمال الفحص من آخر نقطة محفوظة'}); await this._persistJob(accountId,job); await this._recordEvent(accountId,job,'resumed','تم استكمال الفحص من آخر Checkpoint'); this._runScan(accountId,job).catch(()=>{}); this._emit(accountId,job); return true;
  }

  async retryScan(accountId) {
    const job=this._jobs.get(accountId); if(!job||job.status!=='error'||job.retries>=job.maxRetries) return false; job.retries++; job.status='retrying'; job.lastError=null; job.log.push({ts:new Date().toISOString(),msg:`🔄 إعادة المحاولة ${job.retries}/${job.maxRetries}`}); await this._persistJob(accountId,job); await this._recordEvent(accountId,job,'retry','تمت جدولة إعادة المحاولة',{attempt:job.retries}); await sleep(Math.min(30000,1000*2**job.retries + Math.floor(Math.random()*500))); job.status='running'; job._abort=false; this._runScan(accountId,job).catch(()=>{}); this._emit(accountId,job); return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  تنفيذ الفحص الفعلي
  // ══════════════════════════════════════════════════════════════════════════
  async _runScan(accountId, job) {
    try {
      job.status = 'running'; job.lastActivityAt = new Date().toISOString(); await this._persistJob(accountId, job); this._emit(accountId, job);
      // ── [FIX-ROOT] فحص حالة الجلسة بدقة قبل أي شيء ──────────────────────
      // كانت المشكلة السابقة تُظهر "0 محادثة" حتى لو كانت الجلسة منتهية أو
      // الـ QR لم يُمسح بعد، لأن الكود القديم لم يكن يُفرّق بين "متصل بدون
      // محادثات" و "غير متصل أصلاً". الآن نُفرّق بوضوح ونمنع تشغيل فحص
      // لحساب غير متصل حقيقةً.
      const isOnline = WhatsAppManager.isOnline(accountId);
      const sock = WhatsAppManager.getSession(accountId);
      const qrPending = WhatsAppManager.getQrStatus(accountId);

      console.log(`[LinkScanEngine] ── بدء الفحص ──────────────────────────────`);
      console.log(`[LinkScanEngine] Account: ${accountId}`);
      console.log(`[LinkScanEngine] Session Connected: ${isOnline}`);
      console.log(`[LinkScanEngine] Socket Present: ${!!sock}`);
      console.log(`[LinkScanEngine] QR Pending: ${!!qrPending}`);

      if (!isOnline || !sock) {
        const reason = qrPending
          ? 'الحساب غير متصل — يوجد QR لم يتم مسحه بعد. يرجى مسح QR لإكمال الربط'
          : 'الحساب غير متصل بواتساب — يرجى إعادة ربط الجلسة';
        job.status = 'error';
        job.finishedAt = new Date().toISOString();
        job.log.push({ ts: new Date().toISOString(), msg: `❌ ${reason}` });
        console.log(`[LinkScanEngine] ⛔ توقف: ${reason}`);
        this._emit(accountId, job);
        return;
      }

      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);

      // ── جلب المحادثات الحقيقية من واتساب مباشرة ─────────────────────────
      job.log.push({ ts: new Date().toISOString(), msg: '⏳ جاري تحميل المحادثات...' });
      this._emit(accountId, job);

      const { chats, groupsCount, privateCount, excluded, excludedReasons, source }
        = await this._fetchRealChats(accountId, sock, accountDB);

      job.total = chats.length; job.lastActivityAt = new Date().toISOString(); await this._persistJob(accountId, job);

      console.log(`[LinkScanEngine] Source: ${source}`);
      console.log(`[LinkScanEngine] Fetched Chats: ${chats.length}`);
      console.log(`[LinkScanEngine] Groups: ${groupsCount}`);
      console.log(`[LinkScanEngine] Private Chats: ${privateCount}`);
      console.log(`[LinkScanEngine] Excluded: ${excluded}`);
      if (excluded > 0) {
        console.log(`[LinkScanEngine] Excluded Reasons: ${JSON.stringify(excludedReasons)}`);
      }
      console.log(`[LinkScanEngine] Ready For Scan: ${chats.length}`);

      job.log.push({
        ts: new Date().toISOString(),
        msg: `✅ تم العثور على ${chats.length} محادثة — ${groupsCount} مجموعة، ${privateCount} محادثة خاصة`,
      });
      this._emit(accountId, job);

      if (chats.length === 0) {
        job.status = 'finished';
        job.finishedAt = new Date().toISOString();
        job.log.push({
          ts: new Date().toISOString(),
          msg: '⚠️ الحساب متصل لكن لا توجد مجموعات أو محادثات منضم إليها حالياً',
        });
        this._emit(accountId, job);
        return;
      }

      // فحص كل محادثة
      for (let i = Math.max(0, Number(job.checkpointIndex || 0)); i < chats.length; i++) {
        if (job._abort || job.status === 'paused' || job.status === 'stopped') break;

        const chat = chats[i];
        const jid = chat.id;
        const name = chat.name || jid.split('@')[0];

        job.scanned = i + 1;
        job.checkpointIndex = i;
        job.currentChat = name || jid;
        job.progress = Math.round(((i + 1) / chats.length) * 100);
        job.lastActivityAt = new Date().toISOString();
        await this._persistJob(accountId, job); this._emit(accountId, job);

        try {
          // استخراج الروابط من: اسم المحادثة + الوصف (إن وُجد للمجموعات)
          const textSources = [name, chat.description || ''];

          const allText = textSources.join(' ');
          const links = extractLinksFromText(allText);

          for (const url of links) {
            if (job._abort) break;
            const linkType = detectLinkType(url);
            const saved = await this._saveLink(accountDB, accountId, url, linkType, jid, job);
            if (saved === 'new') {
              job.found++;
              job.log.push({
                ts: new Date().toISOString(),
                msg: `🔗 رابط جديد: ${url.replace('https://', '').slice(0, 50)}`,
                url, linkType, from: name,
              });
              this._emit(accountId, job);
            } else if (saved === 'duplicate') {
              job.duplicates++; await this._recordEvent(accountId, job, 'duplicate', `تم تجاهل رابط مكرر: ${url}`, { url });
            } else if (saved === 'invalid') {
              job.invalid++; await this._recordEvent(accountId, job, 'invalid', `رابط غير صالح: ${url}`, { url });
            }
          }
        } catch (chatErr) {
          const info=classifyScanError(chatErr); job.review=(job.review||0)+1; job.log.push({ts:new Date().toISOString(),msg:`⚠️ تعذر فحص ${name}: ${info.message}`}); await this._recordEvent(accountId,job,'chat_error',info.message,{chatId:jid,errorType:info.type}); console.error(`[LinkScanEngine] خطأ في فحص المحادثة ${jid}:`, chatErr.message);
        }

        // انتظار قصير لتجنب إرهاق الموارد
        if (i % 10 === 0 && i > 0) { await this._persistJob(accountId, job); await sleep(100); }
      }

      if (!job._abort && job.status !== 'paused' && job.status !== 'stopped') {
        job.status = 'finished';
        job.progress = 100;
        job.finishedAt = new Date().toISOString();
        job.log.push({
          ts: new Date().toISOString(),
          msg: `✅ اكتمل الفحص — وُجد ${job.found} رابط جديد، ${job.duplicates} مكرر`,
        });
      }

      await this._persistJob(accountId, job); await this._recordEvent(accountId, job, job.status === 'finished' ? 'completed' : job.status, job.status === 'finished' ? 'اكتمل الفحص وحُفظت النتائج' : 'تم حفظ Checkpoint للفحص');
      console.log(`[LinkScanEngine] ── انتهى الفحص: ${job.found} رابط جديد، ${job.duplicates} مكرر ──`);
      this._emit(accountId, job);

    } catch (err) {
      const info=classifyScanError(err); job.status = 'error'; job.errorType=info.type; job.lastError=info.message;
      job.finishedAt = new Date().toISOString();
      job.log.push({ ts: new Date().toISOString(), msg: `❌ ${info.message}` });
      await this._persistJob(accountId, job); await this._recordEvent(accountId, job, 'error', info.message, info);
      console.error(`[LinkScanEngine] خطأ فادح في الفحص لحساب ${accountId}:`, err.message);
      this._emit(accountId, job);
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  [FIX-ROOT] جلب المحادثات الحقيقية من واتساب مباشرة
  //
  //  السبب الجذري للمشكلة القديمة: الكود كان يعتمد على `sock.chats` أو
  //  `WhatsAppManager.getStore(accountId)` كمصدر بيانات، لكن Baileys لا
  //  يُخزّن قائمة محادثات في الذاكرة من تلقاء نفسه (هذا يتطلب
  //  makeInMemoryStore منفصلاً لم يكن مُفعّلاً في WhatsAppManager) —
  //  فكانت النتيجة دائماً مصفوفة فارغة بصرف النظر عن حالة الحساب.
  //  الـ fallback القديم كان يقرأ أيضاً من جدول `groups` غير الموجود
  //  (الجدول الحقيقي اسمه `wa_groups`)، فيفشل بصمت ويُعيد 0 دائماً.
  //
  //  الحل: الاستدعاء المباشر لـ sock.groupFetchAllParticipating() — وهي
  //  نفس الدالة الموثوقة المستخدمة فعلياً في GroupController._syncFromWhatsApp
  //  لمزامنة المجموعات — مع fallback صحيح من جدول wa_groups الحقيقي
  //  عند فشل الاتصال المباشر بواتساب لأي سبب عارض.
  // ══════════════════════════════════════════════════════════════════════════
  async _fetchRealChats(accountId, sock, accountDB) {
    const excludedReasons = {};
    let excluded = 0;
    let source = 'whatsapp_live';

    try {
      // المصدر الأساسي: جلب مباشر وحي من واتساب (مجموعات أنت عضو فيها فعلاً)
      const raw = await sock.groupFetchAllParticipating();
      const entries = Object.entries(raw || {});

      console.log(`[LinkScanEngine] groupFetchAllParticipating returned ${entries.length} entries`);

      const chats = [];
      for (const [jid, meta] of entries) {
        if (!jid || !jid.endsWith('@g.us')) {
          excluded++;
          excludedReasons['not_a_group'] = (excludedReasons['not_a_group'] || 0) + 1;
          continue;
        }
        chats.push({
          id: jid,
          name: meta.subject || jid.split('@')[0],
          description: meta.desc || '',
          isGroup: true,
        });
      }

      // محاولة إضافة محادثات خاصة من السجل التاريخي (تقريبية وليست حية)
      // ── ملاحظة صدق تقنية: Baileys لا يكشف قائمة محادثات خاصة بدون
      // makeInMemoryStore دائم (غير مُفعَّل في هذا النظام). الجدول التالي
      // قد لا يكون موجوداً إن لم يُسجَّل أي تدفق رسائل بعد — هذا متوقع
      // وليس خطأ، ويُعامَل كمصدر تكميلي تقريبي لا كمصدر أساسي موثوق.
      let privateRows = [];
      try {
        const tableExists = await accountDB.get(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.tables
             WHERE table_name = 'baileys_message_flow'
           ) AS exists`
        );
        if (tableExists?.exists) {
          privateRows = await accountDB.all(
            `SELECT DISTINCT jid AS id, jid AS name
             FROM baileys_message_flow
             WHERE account_id = $1 AND jid IS NOT NULL AND jid LIKE '%@s.whatsapp.net'
             LIMIT 1000`,
            [accountId]
          ).catch(() => []);
        } else {
          console.log('[LinkScanEngine] جدول baileys_message_flow غير موجود — لا توجد محادثات خاصة تقريبية متاحة');
        }
      } catch (privErr) {
        console.warn(`[LinkScanEngine] تعذّر فحص جدول المحادثات الخاصة: ${privErr.message}`);
      }

      const privateCount = privateRows.length;
      for (const row of privateRows) {
        chats.push({ id: row.id, name: row.name, description: '', isGroup: false });
      }

      return {
        chats,
        groupsCount: chats.length - privateCount,
        privateCount,
        excluded,
        excludedReasons,
        source,
      };

    } catch (liveErr) {
      // المصدر الاحتياطي: قراءة من جدول wa_groups الحقيقي (آخر مزامنة محفوظة)
      console.warn(`[LinkScanEngine] فشل الجلب المباشر من واتساب: ${liveErr.message} — التحويل لـ wa_groups`);
      source = 'wa_groups_fallback';

      const rows = await accountDB.all(
        `SELECT group_jid AS id, name, description FROM wa_groups WHERE is_member = TRUE LIMIT 2000`
      ).catch((dbErr) => {
        console.error(`[LinkScanEngine] فشل أيضاً قراءة wa_groups: ${dbErr.message}`);
        return [];
      });

      return {
        chats: rows,
        groupsCount: rows.length,
        privateCount: 0,
        excluded,
        excludedReasons,
        source,
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  حفظ رابط في قاعدة البيانات
  // ══════════════════════════════════════════════════════════════════════════
  async _saveLink(accountDB, accountId, url, linkType, groupJid, job = null) {
    try {
      const normalized = canonicalizeUrl(url); if (!normalized) return 'invalid';
      const hash = linkHash(normalized);
      const result = await accountDB.run(`INSERT INTO discovered_links (url,normalized_url,url_hash,link_type,group_jid,discovered_by_account,status,verification_status,join_attempts,discovered_at,first_seen_at,last_seen_at,appearance_count,scan_id,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'new','needs_review',0,NOW(),NOW(),NOW(),1,$7,$8,NOW()) ON CONFLICT (url) DO NOTHING RETURNING id`, [url, normalized, hash, linkType, groupJid || null, accountId, job?.id || null, job?.source || 'whatsapp_live']);
      const inserted = Array.isArray(result?.rows) ? result.rows.length > 0 : Number(result?.rowCount ?? result?.changes ?? 0) > 0;
      if (!inserted) await accountDB.run(`UPDATE discovered_links SET normalized_url=COALESCE(normalized_url,$2),url_hash=COALESCE(url_hash,$3),last_seen_at=NOW(),appearance_count=COALESCE(appearance_count,0)+1,updated_at=NOW() WHERE url=$1`, [url, normalized, hash]);
      return inserted ? 'new' : 'duplicate';
    } catch (err) { const info=classifyScanError(err); if(info.type==='RETRYABLE') throw err; return 'error'; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  إنشاء جدول discovered_links
  // ══════════════════════════════════════════════════════════════════════════
  async _ensureTables(accountDB) {
    await accountDB.run(`
      CREATE TABLE IF NOT EXISTS discovered_links (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        url                   TEXT NOT NULL UNIQUE,
        group_name            TEXT,
        link_type             TEXT DEFAULT 'other',
        group_jid             TEXT,
        discovered_by_account TEXT,
        status                TEXT DEFAULT 'new',
        join_account_used     TEXT,
        joined_at             TIMESTAMPTZ,
        join_fail_reason      TEXT,
        join_attempts         INTEGER DEFAULT 0,
        discovered_at         TIMESTAMPTZ DEFAULT NOW(),
        updated_at            TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {});

    // إضافة الأعمدة الناقصة إن وُجدت
    const cols = [
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS group_name TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS join_account_used TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS join_fail_reason TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS join_attempts INTEGER DEFAULT 0`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS normalized_url TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS url_hash TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS appearance_count INTEGER DEFAULT 1`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified'`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS verification_checked_at TIMESTAMPTZ`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS verification_error TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS scan_id TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS source TEXT`,
    ];
    for (const sql of cols) {
      await accountDB.run(sql).catch(() => {});
    }
    await accountDB.run(`CREATE INDEX IF NOT EXISTS discovered_links_hash_idx ON discovered_links(url_hash)`).catch(() => {});
    await accountDB.run(`CREATE INDEX IF NOT EXISTS discovered_links_status_idx ON discovered_links(status)`).catch(() => {});
    await accountDB.run(`CREATE INDEX IF NOT EXISTS discovered_links_scan_idx ON discovered_links(scan_id)`).catch(() => {});
    await accountDB.run(`CREATE TABLE IF NOT EXISTS link_scan_jobs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, account_ids JSONB DEFAULT '[]', status TEXT NOT NULL DEFAULT 'queued', total INTEGER DEFAULT 0, scanned INTEGER DEFAULT 0, found INTEGER DEFAULT 0, duplicates INTEGER DEFAULT 0, invalid INTEGER DEFAULT 0, review INTEGER DEFAULT 0, retries INTEGER DEFAULT 0, max_retries INTEGER DEFAULT 3, current_chat TEXT, source TEXT, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, last_activity_at TIMESTAMPTZ, last_error TEXT, error_type TEXT, checkpoint_index INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`).catch(() => {});
    await accountDB.run(`CREATE UNIQUE INDEX IF NOT EXISTS link_scan_active_account_idx ON link_scan_jobs(account_id) WHERE status IN ('queued','running','waiting','retrying','processing')`).catch(() => {});
    await accountDB.run(`CREATE TABLE IF NOT EXISTS link_scan_events (id BIGSERIAL PRIMARY KEY, job_id TEXT NOT NULL, account_id TEXT NOT NULL, event_type TEXT NOT NULL, message TEXT, details JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())`).catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  إرسال حدث Socket.IO
  // ══════════════════════════════════════════════════════════════════════════
  _emit(accountId, job) {
    if (!this._io) return;
    try {
      this._io.emit(`link_scan_${accountId}`, {
        accountId,
        status: job.status,
        progress: job.progress,
        total: job.total,
        scanned: job.scanned,
        found: job.found,
        duplicates: job.duplicates,
        currentChat: job.currentChat,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        lastLog: job.log[job.log.length - 1] || null,
      });
      // حدث عام أيضاً
      this._io.emit('link_scan_update', { accountId, status: job.status, found: job.found });
    } catch (_) {}
  }
}

module.exports = new LinkScanEngine();

