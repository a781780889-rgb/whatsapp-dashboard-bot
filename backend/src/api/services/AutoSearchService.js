'use strict';
const { randomUUID } = require('crypto');
const DatabaseManager = require('../../database/DatabaseManager');
const WhatsAppManager = require('../../bot/WhatsAppManager');
const { getPool } = require('../../lib/postgres');
const SocketBridge = require('../../core/SocketBridge');

const URL_RE = /https?:\/\/[^\s<>()]+/gi;
const WHATSAPP_RE = /^(https?:\/\/)?(chat\.whatsapp\.com\/[^\s/]+|whatsapp\.com\/channel\/[^\s/]+)/i;
const DEFAULT_SETTINGS = { scope: 'all', linkTypes: ['whatsapp_group_public', 'whatsapp_group_request', 'whatsapp_channel'], removeSpaces: true, normalize: true, removeDuplicates: true, validate: true, intervalSeconds: 30 };

function textFromMessage(msg) {
  const m = msg?.message || {};
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || m.buttonsResponseMessage?.selectedDisplayText || '';
}
function normalizeUrl(url, settings = DEFAULT_SETTINGS) {
  let out = String(url || '').trim();
  if (settings.removeSpaces !== false) out = out.replace(/\s+/g, '');
  out = out.replace(/[),.;!?؟]+$/g, '');
  if (settings.normalize !== false) out = out.replace(/^http:\/\//i, 'https://');
  return out;
}
function linkType(url) {
  if (/whatsapp\.com\/channel\//i.test(url)) return 'whatsapp_channel';
  if (/chat\.whatsapp\.com\/invite\//i.test(url)) return 'whatsapp_group_request';
  if (/chat\.whatsapp\.com\//i.test(url)) return 'whatsapp_group_public';
  return null;
}
function analyzeLinks(text, settings = DEFAULT_SETTINGS) {
  const valid = []; const invalid = [];
  for (const raw of String(text || '').match(URL_RE) || []) {
    const url = normalizeUrl(raw, settings);
    const type = linkType(url);
    if (!url || !WHATSAPP_RE.test(url) || !type) { invalid.push({ url: raw, normalizedUrl: url }); continue; }
    if (Array.isArray(settings.linkTypes) && settings.linkTypes.length && !settings.linkTypes.includes(type)) { invalid.push({ url: raw, normalizedUrl: url }); continue; }
    valid.push({ url: raw, normalizedUrl: url, type });
  }
  return { valid: [...new Map(valid.map(x => [x.normalizedUrl, x])).values()], invalid };
}
function extractLinks(text, settings = DEFAULT_SETTINGS) { return analyzeLinks(text, settings).valid; }

class AutoSearchService {
  constructor() { this.timer = null; this.busy = false; this.ensureCache = new Set(); this.workerStartedAt = null; this.lastWorkerTick = null; this.instanceId = randomUUID(); }
  async ensure(db) {
    const key = db?.schema || db;
    if (this.ensureCache.has(key)) return;
    const statements = [
      `CREATE TABLE IF NOT EXISTS auto_search_settings (id INT PRIMARY KEY DEFAULT 1, settings JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS auto_search_jobs (id UUID PRIMARY KEY, status VARCHAR(30) DEFAULT 'stopped', selected_account_ids JSONB NOT NULL DEFAULT '[]', settings JSONB NOT NULL DEFAULT '{}', groups_discovered INT DEFAULT 0, groups_scanned INT DEFAULT 0, links_total INT DEFAULT 0, links_new INT DEFAULT 0, links_copied INT DEFAULT 0, links_duplicate INT DEFAULT 0, links_invalid INT DEFAULT 0, started_at TIMESTAMPTZ, paused_at TIMESTAMPTZ, last_scan_at TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `ALTER TABLE auto_search_jobs ADD COLUMN IF NOT EXISTS links_copied INT DEFAULT 0`,
      `ALTER TABLE auto_search_jobs ADD COLUMN IF NOT EXISTS messages_processed INT DEFAULT 0`,
      `ALTER TABLE auto_search_jobs ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ`,
      `ALTER TABLE auto_search_jobs ADD COLUMN IF NOT EXISTS last_link_at TIMESTAMPTZ`,
      `ALTER TABLE auto_search_jobs ADD COLUMN IF NOT EXISTS worker_heartbeat_at TIMESTAMPTZ`,
      `ALTER TABLE auto_search_jobs ADD COLUMN IF NOT EXISTS last_activity_message TEXT`,
      `ALTER TABLE auto_search_jobs ADD COLUMN IF NOT EXISTS worker_instance TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS auto_search_one_active_job ON auto_search_jobs((status IN ('running','paused','waiting','error'))) WHERE status IN ('running','paused','waiting','error')`,
      `CREATE TABLE IF NOT EXISTS auto_search_account_state (job_id UUID NOT NULL REFERENCES auto_search_jobs(id) ON DELETE CASCADE, account_id UUID NOT NULL, status VARCHAR(30) DEFAULT 'idle', groups_total INT DEFAULT 0, groups_scanned INT DEFAULT 0, links_discovered INT DEFAULT 0, links_new INT DEFAULT 0, links_duplicate INT DEFAULT 0, errors INT DEFAULT 0, current_group_jid TEXT, current_group_name TEXT, last_scan_at TIMESTAMPTZ, last_error TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY(job_id,account_id))`,
      `CREATE TABLE IF NOT EXISTS auto_search_groups (job_id UUID NOT NULL REFERENCES auto_search_jobs(id) ON DELETE CASCADE, account_id UUID NOT NULL, group_jid TEXT NOT NULL, group_name TEXT, participant_count INT DEFAULT 0, status VARCHAR(30) DEFAULT 'discovered', last_scanned_at TIMESTAMPTZ, links_found INT DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY(job_id,account_id,group_jid))`,
      `CREATE TABLE IF NOT EXISTS auto_search_links (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID NOT NULL REFERENCES auto_search_jobs(id) ON DELETE CASCADE, normalized_url TEXT NOT NULL, original_url TEXT NOT NULL, link_type VARCHAR(40) DEFAULT 'other', source_group_jid TEXT, source_group_name TEXT, discovered_by_account UUID, status VARCHAR(30) DEFAULT 'new', validation_status VARCHAR(30) DEFAULT 'valid', copy_count INT DEFAULT 0, discovery_count INT DEFAULT 1, first_discovered_at TIMESTAMPTZ DEFAULT NOW(), last_discovered_at TIMESTAMPTZ DEFAULT NOW(), copied_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(job_id,normalized_url))`,
      `ALTER TABLE auto_search_links ADD COLUMN IF NOT EXISTS source_message_id TEXT`,
      `DROP INDEX IF EXISTS auto_search_links_url_unique`,
      `CREATE INDEX IF NOT EXISTS auto_search_links_status_idx ON auto_search_links(job_id,status)`,
      `CREATE TABLE IF NOT EXISTS auto_search_events (id BIGSERIAL PRIMARY KEY, job_id UUID NOT NULL REFERENCES auto_search_jobs(id) ON DELETE CASCADE, account_id UUID, group_jid TEXT, event_type VARCHAR(40) NOT NULL, message TEXT NOT NULL, details JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS auto_search_copies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID NOT NULL REFERENCES auto_search_jobs(id) ON DELETE CASCADE, link_id UUID NOT NULL REFERENCES auto_search_links(id) ON DELETE CASCADE, copied_by TEXT, copied_at TIMESTAMPTZ DEFAULT NOW())`,
    ];
    for (const sql of statements) await db.query(sql).catch(err => console.warn(`[AutoSearch] schema warning: ${err.message}`));
    this.ensureCache.add(key);
  }
  async _db(accountId) { const db = await DatabaseManager.getAccountDB(accountId); await this.ensure(db); return db; }
  async _event(db, jobId, type, message, accountId = null, groupJid = null, details = {}) { await db.query('INSERT INTO auto_search_events(job_id,account_id,group_jid,event_type,message,details) VALUES($1,$2,$3,$4,$5,$6)', [jobId, accountId, groupJid, type, message, JSON.stringify(details)]).catch(() => {}); await this._broadcast(db, jobId); }
  async _broadcast(db, jobId) { try { const [j,a,g,l,e] = await Promise.all([db.query('SELECT * FROM auto_search_jobs WHERE id=$1', [jobId]), db.query('SELECT * FROM auto_search_account_state WHERE job_id=$1 ORDER BY updated_at DESC', [jobId]), db.query('SELECT * FROM auto_search_groups WHERE job_id=$1 ORDER BY updated_at DESC LIMIT 500', [jobId]), db.query('SELECT * FROM auto_search_links WHERE job_id=$1 ORDER BY last_discovered_at DESC LIMIT 500', [jobId]), db.query('SELECT * FROM auto_search_events WHERE job_id=$1 ORDER BY created_at DESC LIMIT 100', [jobId])]); if (j.rows[0]) SocketBridge.to(`auto-search:${jobId}`).emit('auto_search:update', { job: j.rows[0], accounts: a.rows, groups: g.rows, links: l.rows, events: e.rows, serverTime: new Date().toISOString() }); } catch (_) {} }
  async _active(db) { const r = await db.query("SELECT * FROM auto_search_jobs WHERE status IN ('running','waiting','paused','error') ORDER BY created_at DESC LIMIT 1"); return r.rows[0] || null; }
  async getDashboard(accountId) { const db = await this._db(accountId); const job = await this._active(db); if (!job) return { job: null, accounts: [], groups: [], links: [], events: [], settings: DEFAULT_SETTINGS, runtime: { running: Boolean(this.timer && this.lastWorkerTick && Date.now() - this.lastWorkerTick < 5000), workerStartedAt: this.workerStartedAt, lastWorkerTick: this.lastWorkerTick } }; await this._broadcast(db, job.id); const [a,g,l,e,s] = await Promise.all([db.query('SELECT * FROM auto_search_account_state WHERE job_id=$1 ORDER BY updated_at DESC', [job.id]), db.query('SELECT * FROM auto_search_groups WHERE job_id=$1 ORDER BY updated_at DESC LIMIT 500', [job.id]), db.query('SELECT * FROM auto_search_links WHERE job_id=$1 ORDER BY last_discovered_at DESC LIMIT 500', [job.id]), db.query('SELECT * FROM auto_search_events WHERE job_id=$1 ORDER BY created_at DESC LIMIT 100', [job.id]), db.query('SELECT settings FROM auto_search_settings WHERE id=1')]); return { job, accounts: a.rows, groups: g.rows, links: l.rows, events: e.rows, settings: { ...DEFAULT_SETTINGS, ...(s.rows[0]?.settings || {}) }, runtime: { running: Boolean(this.timer && this.lastWorkerTick && Date.now() - this.lastWorkerTick < 5000), workerStartedAt: this.workerStartedAt, lastWorkerTick: this.lastWorkerTick } }; }
  async saveSettings(accountId, settings) { const db = await this._db(accountId); const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) }; await db.query(`INSERT INTO auto_search_settings(id,settings,updated_at) VALUES(1,$1,NOW()) ON CONFLICT(id) DO UPDATE SET settings=$1,updated_at=NOW()`, [JSON.stringify(merged)]); return merged; }
  async start(accountId, accountIds, settings) { const db = await this._db(accountId); const selected = [...new Set(accountIds || [])]; if (!selected.length) throw new Error('حدد حساباً واحداً على الأقل'); const active = await this._active(db); if (active) throw new Error('يوجد محرك بحث نشط بالفعل'); const merged = await this.saveSettings(accountId, settings); const id = randomUUID(); await db.query(`INSERT INTO auto_search_jobs(id,status,selected_account_ids,settings,started_at,updated_at) VALUES($1,'running',$2,$3,NOW(),NOW())`, [id, JSON.stringify(selected), JSON.stringify(merged)]); for (const acc of selected) await db.query(`INSERT INTO auto_search_account_state(job_id,account_id,status) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [id, acc, WhatsAppManager.isReady(acc) ? 'idle' : 'offline']); await this._event(db, id, 'started', 'بدأ محرك البحث التلقائي'); return (await this.getDashboard(accountId)).job; }
  async control(accountId, action) { const db = await this._db(accountId); const job = await this._active(db); if (!job) throw new Error('لا توجد مهمة بحث'); const status = { pause: 'paused', resume: 'running', stop: 'stopped', restart: 'running' }[action]; if (!status) throw new Error('إجراء غير صالح'); await db.query('UPDATE auto_search_jobs SET status=$2,paused_at=CASE WHEN $2=\'paused\' THEN NOW() ELSE paused_at END,updated_at=NOW() WHERE id=$1', [job.id, status]); await this._event(db, job.id, action, action === 'pause' ? 'تم إيقاف البحث مؤقتاً' : action === 'stop' ? 'تم إيقاف النظام' : 'تم استئناف البحث'); return this.getDashboard(accountId); }
  async scanNow(accountId) { const db = await this._db(accountId); const job = await this._active(db); if (!job) throw new Error('شغّل البحث التلقائي أولاً'); await db.query("UPDATE auto_search_jobs SET status='running',updated_at=NOW() WHERE id=$1", [job.id]); await this._runJob(db, job); return this.getDashboard(accountId); }
  async copyLinks(accountId, ids = [], filter = 'new', userId = null) { const db = await this._db(accountId); const job = await this._active(db); if (!job) throw new Error('لا توجد روابط'); const params = [job.id]; let where = 'job_id=$1'; if (ids.length) { params.push(ids); where += ` AND id=ANY($${params.length})`; } else if (filter) { params.push(filter); where += ` AND status=$${params.length}`; } const rows = await db.query(`SELECT * FROM auto_search_links WHERE ${where} ORDER BY last_discovered_at DESC`, params); for (const row of rows.rows) { await db.query('INSERT INTO auto_search_copies(job_id,link_id,copied_by) VALUES($1,$2,$3)', [job.id, row.id, userId]).catch(() => {}); await db.query("UPDATE auto_search_links SET status='copied',copy_count=copy_count+1,copied_at=NOW(),updated_at=NOW() WHERE id=$1", [row.id]); } await db.query('UPDATE auto_search_jobs SET links_copied=links_copied+$2,updated_at=NOW() WHERE id=$1', [job.id, rows.rows.length]); await this._event(db, job.id, 'copied', `تم تسجيل نسخ ${rows.rows.length} رابط`); return { count: rows.rows.length, links: rows.rows.map(r => r.normalized_url) }; }
  async listLinks(accountId, query = {}) { const db = await this._db(accountId); const job = await this._active(db); if (!job) return { links: [], total: 0 }; const params = [job.id]; const clauses = ['job_id=$1']; if (query.status) { params.push(query.status); clauses.push(`status=$${params.length}`); } if (query.q) { params.push(`%${query.q}%`); clauses.push(`(normalized_url ILIKE $${params.length} OR source_group_name ILIKE $${params.length})`); } const r = await db.query(`SELECT * FROM auto_search_links WHERE ${clauses.join(' AND ')} ORDER BY last_discovered_at DESC LIMIT 1000`, params); return { links: r.rows, total: r.rows.length }; }
  async ingestMessage(accountId, msg) { const jid = msg?.key?.remoteJid; if (!jid?.endsWith('@g.us')) return; const db = await this._db(accountId); const job = await this._active(db); if (!job || !['running','waiting'].includes(job.status)) return; const settings = { ...DEFAULT_SETTINGS, ...(job.settings || {}) }; const analysis = analyzeLinks(textFromMessage(msg), settings); await db.query('UPDATE auto_search_jobs SET messages_processed=messages_processed+1,last_activity_at=NOW(),last_activity_message=$2,worker_heartbeat_at=NOW(),updated_at=NOW() WHERE id=$1', [job.id, `تمت معالجة رسالة من ${jid}`]).catch(() => {}); for (const item of analysis.valid) await this._saveLink(db, job, accountId, jid, jid, item, msg.key?.id || null); if (analysis.invalid.length) await db.query('UPDATE auto_search_jobs SET links_invalid=links_invalid+$2,last_activity_at=NOW(),updated_at=NOW() WHERE id=$1', [job.id, analysis.invalid.length]).catch(() => {}); await this._broadcast(db, job.id); }
  async _saveLink(db, job, accountId, groupJid, groupName, item, sourceMessageId = null) { const inserted = await db.query(`INSERT INTO auto_search_links(job_id,normalized_url,original_url,link_type,source_group_jid,source_group_name,discovered_by_account,source_message_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'new') ON CONFLICT (job_id,normalized_url) DO NOTHING RETURNING id`, [job.id, item.normalizedUrl, item.url, item.type, groupJid, groupName, accountId, sourceMessageId]); if (!inserted.rows[0]) { const existing = await db.query('SELECT id FROM auto_search_links WHERE job_id=$1 AND normalized_url=$2', [job.id, item.normalizedUrl]); await db.query('UPDATE auto_search_links SET discovery_count=discovery_count+1,last_discovered_at=NOW(),updated_at=NOW() WHERE job_id=$1 AND normalized_url=$2', [job.id, item.normalizedUrl]); await db.query('UPDATE auto_search_jobs SET links_duplicate=links_duplicate+1,links_total=links_total+1,last_activity_at=NOW(),last_activity_message=$2,updated_at=NOW() WHERE id=$1', [job.id, `رابط مكرر: ${item.normalizedUrl}`]); await this._event(db, job.id, 'duplicate', `تم تجاهل رابط مكرر: ${item.normalizedUrl}`, accountId, groupJid, { linkId: existing.rows[0]?.id }); return 'duplicate'; } await db.query('UPDATE auto_search_jobs SET links_new=links_new+1,links_total=links_total+1,last_link_at=NOW(),last_activity_at=NOW(),last_activity_message=$2,updated_at=NOW() WHERE id=$1', [job.id, `رابط واتساب جديد: ${item.normalizedUrl}`]); await this._event(db, job.id, 'new_link', `تم اكتشاف رابط واتساب جديد: ${item.normalizedUrl}`, accountId, groupJid, { linkId: inserted.rows[0].id, linkType: item.type }); return 'new'; }
  async _runJob(db, job) { if (this.busy) return; this.busy = true; try { const selected = Array.isArray(job.selected_account_ids) ? job.selected_account_ids : JSON.parse(job.selected_account_ids || '[]'); for (const accountId of selected) { try { if (!WhatsAppManager.isReady(accountId)) { await db.query("UPDATE auto_search_account_state SET status='reconnect',last_error='الحساب غير متصل',updated_at=NOW() WHERE job_id=$1 AND account_id=$2", [job.id, accountId]); await this._event(db, job.id, 'reconnect', 'الحساب يحتاج إلى إعادة اتصال', accountId); continue; } const sock = WhatsAppManager.getSession(accountId); if (!sock?.groupFetchAllParticipating) throw new Error('جلسة واتساب غير جاهزة للفحص'); await db.query("UPDATE auto_search_account_state SET status='scanning',last_error=NULL,updated_at=NOW() WHERE job_id=$1 AND account_id=$2", [job.id, accountId]); const groups = Object.entries(await sock.groupFetchAllParticipating() || {}); await db.query('UPDATE auto_search_jobs SET groups_discovered=groups_discovered+$2,groups_scanned=groups_scanned+$2,last_scan_at=NOW(),last_activity_at=NOW(),last_activity_message=$3,worker_heartbeat_at=NOW(),updated_at=NOW() WHERE id=$1', [job.id, groups.length, `فحص ${groups.length} مجموعة`]); await db.query('UPDATE auto_search_account_state SET groups_total=$3,last_scan_at=NOW(),updated_at=NOW() WHERE job_id=$1 AND account_id=$2', [job.id, accountId, groups.length]); for (const [groupJid, meta] of groups) { const name = meta?.subject || groupJid; await db.query(`INSERT INTO auto_search_groups(job_id,account_id,group_jid,group_name,participant_count,status,last_scanned_at) VALUES($1,$2,$3,$4,$5,'scanned',NOW()) ON CONFLICT(job_id,account_id,group_jid) DO UPDATE SET group_name=$4,participant_count=$5,status='scanned',last_scanned_at=NOW(),updated_at=NOW()`, [job.id, accountId, groupJid, name, Number(meta?.size || 0)]); const analysis = analyzeLinks(`${name} ${meta?.desc || ''}`, job.settings || DEFAULT_SETTINGS); for (const item of analysis.valid) await this._saveLink(db, job, accountId, groupJid, name, item); if (analysis.invalid.length) await db.query('UPDATE auto_search_jobs SET links_invalid=links_invalid+$2,updated_at=NOW() WHERE id=$1', [job.id, analysis.invalid.length]); await db.query('UPDATE auto_search_account_state SET groups_scanned=groups_scanned+1,current_group_jid=$3,current_group_name=$4,updated_at=NOW() WHERE job_id=$1 AND account_id=$2', [job.id, accountId, groupJid, name]); await this._event(db, job.id, 'group_scanned', `تم فحص المجموعة: ${name}`, accountId, groupJid); } await db.query("UPDATE auto_search_account_state SET status='idle',current_group_jid=NULL,current_group_name=NULL,last_error=NULL,updated_at=NOW() WHERE job_id=$1 AND account_id=$2", [job.id, accountId]); } catch (accountError) { await db.query("UPDATE auto_search_account_state SET status='error',errors=errors+1,last_error=$3,updated_at=NOW() WHERE job_id=$1 AND account_id=$2", [job.id, accountId, accountError.message]).catch(() => {}); await this._event(db, job.id, 'account_error', `الحساب ${accountId} فشل: ${accountError.message}`, accountId); } } await db.query('UPDATE auto_search_jobs SET status=CASE WHEN status=\'running\' THEN \'waiting\' ELSE status END,worker_heartbeat_at=NOW(),last_activity_at=NOW(),updated_at=NOW() WHERE id=$1', [job.id]); await this._broadcast(db, job.id); } catch (error) { await db.query("UPDATE auto_search_jobs SET status='error',last_error=$2,updated_at=NOW() WHERE id=$1", [job.id, error.message]); await this._event(db, job.id, 'error', `حدث خطأ في العامل: ${error.message}`); } finally { this.busy = false; } }
  async startWorker() {
    if (this.timer) return;
    this.workerStartedAt = new Date().toISOString();
    const rows = await getPool().query('SELECT id FROM accounts').catch(() => ({ rows: [] }));
    for (const row of rows.rows) {
      try {
        const db = await this._db(row.id);
        await db.query("UPDATE auto_search_account_state SET status='idle',current_group_jid=NULL,current_group_name=NULL WHERE status='scanning'").catch(() => {});
      } catch (error) { console.error(`[AutoSearchWorker] init account ${row.id}: ${error.message}`); }
    }
    this.timer = setInterval(async () => {
      this.lastWorkerTick = Date.now();
      if (this.busy) return;
      const rows2 = await getPool().query('SELECT id FROM accounts').catch(() => ({ rows: [] }));
      for (const row of rows2.rows) {
        try {
          const db = await this._db(row.id);
          const job = await db.query("SELECT * FROM auto_search_jobs WHERE status IN ('running','waiting') ORDER BY created_at DESC LIMIT 1").then(r => r.rows[0]).catch(() => null);
          const settings = job?.settings && typeof job.settings === 'string' ? JSON.parse(job.settings) : (job?.settings || {});
          const due = job && (job.status === 'running' || !job.last_scan_at || Date.now() - new Date(job.last_scan_at).getTime() >= Number(settings.intervalSeconds || 30) * 1000);
          if (due) await this._runJob(db, job);
        } catch (error) { console.error(`[AutoSearchWorker] account ${row.id}: ${error.message}`); }
      }
    }, 1000);
  }
  stopWorker() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
module.exports = new AutoSearchService();
module.exports.extractLinks = extractLinks;
module.exports.analyzeLinks = analyzeLinks;
module.exports.linkType = linkType;
module.exports.normalizeUrl = normalizeUrl;
