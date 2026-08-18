'use strict';
/**
 * LinkScanController — تحكم في البحث التلقائي والانضمام
 *
 * Endpoints الجديدة:
 *   POST   /accounts/:accountId/links/scan/start
 *   POST   /accounts/:accountId/links/scan/stop
 *   GET    /accounts/:accountId/links/scan/status
 *   GET    /links/scan/all-status
 *   POST   /links/scan/start-all
 *
 *   GET    /accounts/:accountId/links/discovered
 *   GET    /accounts/:accountId/links/discovered/stats
 *   DELETE /accounts/:accountId/links/discovered/duplicates
 *   DELETE /accounts/:accountId/links/discovered/:linkId
 *   PATCH  /accounts/:accountId/links/discovered/:linkId/status
 *
 *   POST   /accounts/:accountId/links/discovered/join
 *   POST   /links/discovered/join-multi (لعدة حسابات)
 *   POST   /accounts/:accountId/links/discovered/import
 *
 *   GET    /accounts/:accountId/links/join-history
 *   GET    /links/join-history/all
 *
 *   GET    /accounts/:accountId/links/join-settings
 *   PUT    /accounts/:accountId/links/join-settings
 */

const LinkScanEngine  = require('../services/LinkScanEngine');
const DatabaseManager = require('../../database/DatabaseManager');
const WhatsAppManager = require('../../bot/WhatsAppManager');
const crypto          = require('crypto');
const { parseMany, parseSupportedUrl, classifyJoinError } = require('../services/LinkUrlProcessingService');

// يتم استخراج كود الدعوة بعد التطبيع، ولا يتم استخدام HTTP كحكم نهائي على صلاحية الرابط.
const activeJoinLinks = new Set();

class LinkScanController {

  // ══════════════════════════════════════════════════════════════════════════
  //  جداول قاعدة البيانات
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

    await accountDB.run(`
      CREATE TABLE IF NOT EXISTS join_history (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        link_id       UUID REFERENCES discovered_links(id) ON DELETE CASCADE,
        url           TEXT NOT NULL,
        account_id    TEXT NOT NULL,
        status        TEXT DEFAULT 'pending',
        result_msg    TEXT,
        fail_reason   TEXT,
        attempted_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {});

    await accountDB.run(`
      CREATE TABLE IF NOT EXISTS link_join_settings (
        id                      TEXT PRIMARY KEY DEFAULT 'default',
        delay_between_joins_sec INTEGER DEFAULT 30,
        random_delay_enabled    BOOLEAN DEFAULT false,
        random_delay_max_sec    INTEGER DEFAULT 60,
        max_retries             INTEGER DEFAULT 2,
        max_joins_per_hour      INTEGER DEFAULT 20,
        max_joins_per_day       INTEGER DEFAULT 100,
        skip_duplicates         BOOLEAN DEFAULT true,
        skip_disabled           BOOLEAN DEFAULT true,
        updated_at              TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {});

    const alterCols = [
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS group_name TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS join_account_used TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS join_fail_reason TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS join_attempts INTEGER DEFAULT 0`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS original_url TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS normalized_url TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS canonical_url TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS url_hash TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'unvalidated'`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS join_status TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS error_code TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS error_category TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS error_message TEXT`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS retryable BOOLEAN DEFAULT false`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`,
      `ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS job_id TEXT`,
    ];
    for (const sql of alterCols) {
      await accountDB.run(sql).catch(() => {});
    }
    await LinkScanEngine._ensureTables(accountDB).catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  بدء الفحص
  // ══════════════════════════════════════════════════════════════════════════
  async startScan(req, res) {
    try {
      const { accountId } = req.params;
      const { accountIds = [] } = req.body;
      const ids = accountIds.length > 0 ? accountIds : [accountId];

      const started = await LinkScanEngine.startScan(ids);
      res.json({ success: true, message: `تمت معالجة طلب الفحص: ${started.started?.length || 0} مهمة بدأت`, ...started });
    } catch (err) {
      console.error('StartScan error:', err);
      res.status(500).json({ success: false, error: 'تعذر بدء الفحص', details: { code: err.code || 'SCAN_START_FAILED' } });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  إيقاف الفحص
  // ══════════════════════════════════════════════════════════════════════════
  async stopScan(req, res) {
    try {
      const { accountId } = req.params;
      const stopped = await LinkScanEngine.stopScan(accountId);
      res.json({ success: true, stopped, message: stopped ? 'تم إيقاف الفحص بأمان' : 'لا يوجد فحص نشط' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'تعذر إيقاف الفحص بأمان', details: { code: err.code || 'SCAN_STOP_FAILED' } });
    }
  }

  async pauseScan(req,res){try{const paused=await LinkScanEngine.pauseScan(req.params.accountId);res.json({success:true,paused,message:paused?'تم إيقاف الفحص مؤقتاً':'لا توجد مهمة قابلة للإيقاف المؤقت'})}catch(err){res.status(500).json({success:false,error:'تعذر إيقاف الفحص مؤقتاً'})}}
  async resumeScan(req,res){try{const resumed=await LinkScanEngine.resumeScan(req.params.accountId);res.json({success:true,resumed,message:resumed?'تم استكمال الفحص من آخر نقطة محفوظة':'لا توجد مهمة قابلة للاستكمال'})}catch(err){res.status(500).json({success:false,error:'تعذر استكمال الفحص'})}}
  async retryScan(req,res){try{const retried=await LinkScanEngine.retryScan(req.params.accountId);res.json({success:true,retried,message:retried?'تمت جدولة إعادة المحاولة':'لا توجد مهمة فاشلة قابلة للإعادة'})}catch(err){res.status(500).json({success:false,error:'تعذر جدولة إعادة المحاولة'})}}

  // ══════════════════════════════════════════════════════════════════════════
  //  حالة الفحص
  // ══════════════════════════════════════════════════════════════════════════
  async getScanStatus(req, res) {
    try {
      const { accountId } = req.params;
      const job = await LinkScanEngine.loadJob(accountId);
      res.json({ success: true, job });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getAllScanStatus(req, res) {
    try {
      const jobs = LinkScanEngine.getAllJobs();
      res.json({ success: true, jobs });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async startScanAll(req, res) {
    try {
      const { query } = require('../../lib/postgres');
      const rows = await query(`
        SELECT id FROM accounts WHERE status = 'connected' AND user_id = $1
      `, [req.user?.id || '']).catch(() => ({ rows: [] }));

      const ids = rows.rows.map(r => r.id);
      if (ids.length === 0) {
        return res.status(400).json({ success: false, error: 'لا توجد حسابات متصلة' });
      }

      const started = await LinkScanEngine.startScan(ids);
      res.json({ success: true, message: `تمت معالجة طلب الفحص: ${started.started?.length || 0} مهمة بدأت`, ...started });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  جلب الروابط المكتشفة
  // ══════════════════════════════════════════════════════════════════════════
  async getDiscoveredLinks(req, res) {
    try {
      const { accountId } = req.params;
      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);

      const limit    = Math.min(parseInt(req.query.limit || req.query.pageSize) || 200, 1000);
      const page     = Math.max(parseInt(req.query.page) || 1, 1);
      const offset   = (page - 1) * limit;
      const status   = req.query.status    || null;
      const linkType = req.query.linkType  || null;
      const search   = req.query.search    || null;
      const sortBy   = ['discovered_at','status','link_type','join_attempts'].includes(req.query.sortBy)
                       ? req.query.sortBy : 'discovered_at';
      const sortDir  = req.query.sortDir === 'ASC' ? 'ASC' : 'DESC';

      const conditions = ['1=1'];
      const params = [];
      let pIdx = 1;

      const add = (cond, val) => {
        conditions.push(cond.replace('?', `$${pIdx++}`));
        params.push(val);
      };

      if (status)   add(`status = ?`, status);
      if (linkType) add(`link_type = ?`, linkType);
      if (search) {
        conditions.push(`(url ILIKE $${pIdx} OR group_name ILIKE $${pIdx+1})`);
        params.push(`%${search}%`, `%${search}%`);
        pIdx += 2;
      }

      const where = conditions.join(' AND ');
      const countParams = [...params];
      params.push(limit, offset);
      const links = await accountDB.all(`SELECT * FROM discovered_links WHERE ${where} ORDER BY ${sortBy} ${sortDir} LIMIT $${pIdx} OFFSET $${pIdx + 1}`, params);
      const totalRow = await accountDB.get(`SELECT COUNT(*) AS cnt FROM discovered_links WHERE ${where}`, countParams).catch(() => ({ cnt: links.length }));
      const total = Number(totalRow?.cnt || 0);
      res.json({ success: true, links, count: links.length, page, pageSize: limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
    } catch (err) {
      console.error('GetDiscoveredLinks error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  إحصائيات الروابط المكتشفة
  // ══════════════════════════════════════════════════════════════════════════
  async getDiscoveredStats(req, res) {
    try {
      const { accountId } = req.params;
      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);

      const [
        total, byStatus, byType, duplicates, recent,
        joinedToday, failedToday, newToday, newHour,
      ] = await Promise.all([
        accountDB.get(`SELECT COUNT(*) AS cnt FROM discovered_links`),
        accountDB.all(`SELECT status, COUNT(*) AS cnt FROM discovered_links GROUP BY status`),
        accountDB.all(`SELECT link_type, COUNT(*) AS cnt FROM discovered_links GROUP BY link_type ORDER BY cnt DESC`),
        accountDB.get(`SELECT COUNT(*) AS cnt FROM (
          SELECT url FROM discovered_links GROUP BY url HAVING COUNT(*) > 1
        ) t`),
        accountDB.get(`SELECT discovered_at FROM discovered_links ORDER BY discovered_at DESC LIMIT 1`),
        accountDB.get(`SELECT COUNT(*) AS cnt FROM discovered_links WHERE status='joined' AND joined_at >= NOW() - INTERVAL '1 day'`),
        accountDB.get(`SELECT COUNT(*) AS cnt FROM discovered_links WHERE status='failed' AND updated_at >= NOW() - INTERVAL '1 day'`),
        accountDB.get(`SELECT COUNT(*) AS cnt FROM discovered_links WHERE discovered_at >= NOW() - INTERVAL '1 day'`),
        accountDB.get(`SELECT COUNT(*) AS cnt FROM discovered_links WHERE discovered_at >= NOW() - INTERVAL '1 hour'`),
      ]);

      const statusMap = {};
      (byStatus || []).forEach(r => { statusMap[r.status] = r.cnt; });

      // إحصائيات مهمة الفحص
      const scanJob = LinkScanEngine.getJob(accountId);

      res.json({
        success: true,
        stats: {
          total:          total?.cnt || 0,
          new:            statusMap['new']     || 0,
          queued:         statusMap['queued']  || 0,
          joining:        statusMap['joining'] || 0,
          joined:         statusMap['joined']  || 0,
          alreadyJoined:  statusMap['already_joined'] || 0,
          retryPending:   statusMap['retry_pending'] || 0,
          invalidLink:    statusMap['invalid_link'] || 0,
          expiredLink:    statusMap['expired_link'] || 0,
          accountError:   statusMap['account_error'] || 0,
          accountRestricted: statusMap['account_restricted'] || 0,
          rateLimited:    statusMap['rate_limited'] || 0,
          temporaryError: statusMap['temporary_error'] || 0,
          joinFailed:     statusMap['join_failed'] || 0,
          failed:         statusMap['failed']  || 0,
          disabled:       statusMap['disabled']|| 0,
          blocked:        statusMap['blocked'] || 0,
          duplicates:     duplicates?.cnt || 0,
          lastDiscovered: recent?.discovered_at || null,
          byType:         byType || [],
                    joinedToday:   joinedToday?.cnt || 0,
          failedToday:   failedToday?.cnt || 0,
          newToday:      newToday?.cnt || 0,
          newHour:       newHour?.cnt || 0,
          health:        { database: 'healthy', monitoringEngine: scanJob && ['running','processing','queued','retrying','waiting'].includes(scanJob.status) ? 'running' : 'idle' },
          scan:           scanJob,
        },
      });
    } catch (err) {
      console.error('GetDiscoveredStats error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  حذف المكرر
  // ══════════════════════════════════════════════════════════════════════════
  async deleteDuplicates(req, res) {
    try {
      const { accountId } = req.params;
      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);

      // احتفظ بأقدم سجل لكل URL، احذف الباقي
      const result = await accountDB.run(`
        DELETE FROM discovered_links
        WHERE id NOT IN (
          SELECT MIN(id::text)::uuid FROM discovered_links GROUP BY url
        )
      `);

      const deleted = result?.rowCount || result?.changes || 0;
      res.json({ success: true, deleted, message: `تم حذف ${deleted} رابط مكرر` });
    } catch (err) {
      console.error('DeleteDuplicates error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  حذف رابط
  // ══════════════════════════════════════════════════════════════════════════
  async deleteDiscoveredLink(req, res) {
    try {
      const { accountId, linkId } = req.params;
      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await accountDB.run(`DELETE FROM join_history WHERE link_id = $1`, [linkId]).catch(() => {});
      await accountDB.run(`DELETE FROM discovered_links WHERE id = $1`, [linkId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  تحديث حالة رابط
  // ══════════════════════════════════════════════════════════════════════════
  async updateLinkStatus(req, res) {
    try {
      const { accountId, linkId } = req.params;
      const { status } = req.body;
      const validStatuses = ['new','queued','joining','joined','already_joined','retry_pending','invalid_link','unsupported_link','expired_link','account_error','account_restricted','rate_limited','temporary_error','network_error','join_failed','failed','disabled','blocked'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: 'حالة غير صالحة' });
      }
      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await accountDB.run(
        `UPDATE discovered_links SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, linkId]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  الانضمام للروابط المكتشفة
  // ══════════════════════════════════════════════════════════════════════════
  async joinDiscoveredLinks(req, res) {
    try {
      const { accountId } = req.params;
      const {
        linkIds          = [],
        accountIds       = [],
        delaySeconds     = 30,
        randomDelay      = false,
        randomDelayMax   = 60,
        distributionMode = 'single',
      } = req.body;

      if (!linkIds || linkIds.length === 0) {
        return res.status(400).json({ success: false, error: 'لم يتم تحديد أي روابط' });
      }

      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);

      const placeholders = linkIds.map((_, i) => `$${i + 1}`).join(',');
      const links = await accountDB.all(
        `SELECT id, url, link_type, status FROM discovered_links WHERE id IN (${placeholders})`,
        linkIds
      );

      if (links.length === 0) {
        return res.status(404).json({ success: false, error: 'الروابط غير موجودة' });
      }

      const effectiveAccountIds = accountIds.length > 0 ? accountIds : [accountId];
      const linkKeys = links.map(link => link.id);
      const locked = links.filter(link => activeJoinLinks.has(link.id));
      if (locked.length) {
        return res.status(409).json({ success: false, code: 'DUPLICATE_JOB', error: 'يوجد تشغيل نشط لبعض الروابط المحددة', linkIds: locked.map(link => link.id) });
      }

      const jobId = crypto.randomUUID();
      for (const key of linkKeys) activeJoinLinks.add(key);
      await accountDB.run(
        `UPDATE discovered_links SET status='queued', join_status='queued', job_id=$${linkIds.length + 1}, updated_at=NOW() WHERE id IN (${placeholders})`,
        [...linkIds, jobId]
      );
      this._runJoinJob(accountId, links, effectiveAccountIds, {
        delaySeconds, randomDelay, randomDelayMax, distributionMode, jobId,
      }).catch(err => console.error('[JoinJob] Error:', err));

      res.json({ success: true, jobId, message: `تم وضع ${links.length} رابطًا في قائمة الانضمام`, linksCount: links.length, accountsCount: effectiveAccountIds.length });
    } catch (err) {
      console.error('JoinDiscoveredLinks error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  تنفيذ عملية الانضمام في الخلفية
  // ══════════════════════════════════════════════════════════════════════════
  async _runJoinJob(sourceAccountId, links, accountIds, options) {
    const { delaySeconds, randomDelay, randomDelayMax, jobId } = options;
    const accountDB = await DatabaseManager.getAccountDB(sourceAccountId);
    const io = LinkScanEngine._io;
    const maxAttempts = 3;
    let done = 0;

    const emitProgress = (data) => {
      if (io) io.emit(`link_join_${sourceAccountId}`, { jobId, ...data });
    };

    emitProgress({ status: 'running', total: links.length, done: 0 });
    try {
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const targetAccountId = accountIds[i % accountIds.length];
        const parsed = parseSupportedUrl(link.url);
        try {
          if (!parsed.ok) {
            await this._recordJoin(accountDB, link.id, link.url, targetAccountId, parsed.code === 'INVALID_LINK' || parsed.code === 'INVALID_FORMAT' ? 'invalid_link' : 'unsupported_link', parsed.reason, { errorCode: parsed.code, category: 'validation', retryable: false, normalizedUrl: null, canonicalUrl: null });
          } else if (!WhatsAppManager.getSession(targetAccountId) || (WhatsAppManager.isReady && !WhatsAppManager.isReady(targetAccountId))) {
            await this._recordJoin(accountDB, link.id, link.url, targetAccountId, 'account_error', 'الحساب غير متصل أو الجلسة غير جاهزة', { errorCode: 'ACCOUNT_NOT_READY', category: 'account', retryable: true, normalizedUrl: parsed.normalizedUrl, canonicalUrl: parsed.canonicalUrl });
          } else {
            let finalResult = null;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              await accountDB.run(`UPDATE discovered_links SET status='joining', join_status='joining', join_account_used=$1, last_attempt_at=NOW(), updated_at=NOW() WHERE id=$2`, [targetAccountId, link.id]);
              try {
                const result = await WhatsAppManager.getSession(targetAccountId).groupAcceptInvite(parsed.inviteCode);
                if (!result) throw Object.assign(new Error('لم تُرجع WhatsApp نتيجة انضمام مؤكدة'), { code: 'EMPTY_JOIN_RESULT' });
                finalResult = { status: 'joined', errorCode: null, category: 'success', retryable: false, severity: 'info', userMessage: 'تم الانضمام بنجاح', technicalMessage: null, result };
                await this._recordJoin(accountDB, link.id, link.url, targetAccountId, 'joined', null, { ...finalResult, normalizedUrl: parsed.normalizedUrl, canonicalUrl: parsed.canonicalUrl, attempt });
                break;
              } catch (joinErr) {
                const classified = classifyJoinError(joinErr);
                const canRetry = classified.retryable && attempt < maxAttempts;
                await this._recordJoin(accountDB, link.id, link.url, targetAccountId, canRetry ? 'retry_pending' : classified.status, classified.technicalMessage, { ...classified, normalizedUrl: parsed.normalizedUrl, canonicalUrl: parsed.canonicalUrl, attempt, nextRetryAt: canRetry ? new Date(Date.now() + Math.min(30000, 1000 * 2 ** attempt)).toISOString() : null });
                finalResult = classified;
                if (!canRetry) break;
                await new Promise(resolve => setTimeout(resolve, Math.min(30000, 1000 * 2 ** attempt)));
              }
            }
            emitProgress({ status: 'running', total: links.length, done: done + 1, lastUrl: link.url, result: finalResult });
          }
        } catch (err) {
          const classified = classifyJoinError(err);
          await this._recordJoin(accountDB, link.id, link.url, targetAccountId, classified.status, classified.technicalMessage, classified);
        } finally {
          done++;
          emitProgress({ status: 'running', total: links.length, done, lastUrl: link.url });
          activeJoinLinks.delete(link.id);
        }

        if (i < links.length - 1) {
          let delay = Math.max(0, Number(delaySeconds) || 0) * 1000;
          if (randomDelay && randomDelayMax > delaySeconds) delay += Math.floor(Math.random() * (randomDelayMax - delaySeconds) * 1000);
          if (delay > 0) await new Promise(resolve => setTimeout(resolve, Math.max(delay, 1000)));
        }
      }
    } finally {
      for (const link of links) activeJoinLinks.delete(link.id);
      emitProgress({ status: 'finished', total: links.length, done });
    }
  }

  async _recordJoin(accountDB, linkId, url, accountId, status, failReason, details = {}) {
    const errorCode = details.errorCode || null;
    const category = details.category || null;
    const retryable = Boolean(details.retryable);
    try {
      await accountDB.run(
        `UPDATE discovered_links SET status=$1, join_status=$1, join_account_used=$2, updated_at=NOW(),
         join_attempts=join_attempts+1, joined_at=CASE WHEN $1 IN ('joined','already_joined') THEN COALESCE(joined_at,NOW()) ELSE joined_at END,
         join_fail_reason=$3, normalized_url=COALESCE($4,normalized_url), canonical_url=COALESCE($5,canonical_url),
         validation_status=CASE WHEN $4 IS NULL THEN validation_status ELSE 'supported' END, error_code=$6, error_category=$7,
         error_message=$8, retryable=$9, next_retry_at=$10, last_attempt_at=NOW()
         WHERE id=$11`,
        [status, accountId, failReason || null, details.normalizedUrl || null, details.canonicalUrl || null, errorCode, category, failReason || details.userMessage || null, retryable, details.nextRetryAt || null, linkId]
      );
      await accountDB.run(
        `INSERT INTO join_history (link_id,url,account_id,status,result_msg,fail_reason,attempted_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [linkId, url, accountId, status, details.userMessage || null, failReason || null]
      ).catch(() => {});
    } catch (error) {
      console.warn(`[LinkJoin] persistence failed for ${linkId}: ${error.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  استيراد روابط من ملف
  // ══════════════════════════════════════════════════════════════════════════
  async importLinks(req, res) {
    try {
      const { accountId } = req.params;
      const { links = [], raw = '' } = req.body;
      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);
      const parsedItems = parseMany([...(Array.isArray(links) ? links : []), raw]);
      let imported = 0, duplicates = 0, invalid = 0, unsupported = 0;
      const preview = [];

      for (const item of parsedItems) {
        if (!item.originalUrl) continue;
        if (!item.ok) {
          invalid += item.code === 'INVALID_LINK' || item.code === 'INVALID_FORMAT' ? 1 : 0;
          unsupported += item.code === 'UNSUPPORTED_LINK' ? 1 : 0;
          const rawUrl = String(item.originalUrl).trim();
          await accountDB.run(
            `INSERT INTO discovered_links (url, original_url, link_type, discovered_by_account, status, validation_status, error_code, error_category, error_message, retryable, discovered_at, updated_at)
             VALUES ($1,$2,'other',$3,$4,'invalid',$5,'validation',$6,false,NOW(),NOW()) ON CONFLICT (url) DO NOTHING`,
            [rawUrl, rawUrl, accountId, item.code === 'UNSUPPORTED_LINK' ? 'unsupported_link' : 'invalid_link', item.code, item.reason]
          ).catch(() => {});
          preview.push({ original_url: rawUrl, status: item.code === 'UNSUPPORTED_LINK' ? 'unsupported_link' : 'invalid_link', error_code: item.code, message: item.reason });
          continue;
        }

        const result = await accountDB.run(
          `INSERT INTO discovered_links (url, original_url, normalized_url, canonical_url, url_hash, link_type, discovered_by_account, status, validation_status, join_status, discovered_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'new','supported','pending',NOW(),NOW()) ON CONFLICT (url) DO NOTHING`,
          [item.canonicalUrl, item.originalUrl, item.normalizedUrl, item.canonicalUrl, item.urlHash, item.type, accountId]
        );
        const inserted = Number(result?.rowCount ?? result?.changes ?? 0) > 0;
        if (inserted) imported++; else duplicates++;
        preview.push({ original_url: item.originalUrl, normalized_url: item.normalizedUrl, canonical_url: item.canonicalUrl, status: inserted ? 'new' : 'duplicate', validation_status: 'supported' });
      }

      res.json({ success: true, imported, duplicates, invalid, unsupported, preview, message: `تمت معالجة ${parsedItems.length} عنصرًا: ${imported} جديد، ${duplicates} مكرر، ${invalid} غير صالح فعليًا، ${unsupported} غير مدعوم` });
    } catch (err) {
      console.error('ImportLinks error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  سجل الانضمام
  // ══════════════════════════════════════════════════════════════════════════
  async getJoinHistory(req, res) {
    try {
      const { accountId } = req.params;
      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);

      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const history = await accountDB.all(
        `SELECT jh.*, dl.link_type, dl.group_name
         FROM join_history jh
         LEFT JOIN discovered_links dl ON dl.url = jh.url
         ORDER BY jh.attempted_at DESC
         LIMIT $1`,
        [limit]
      );

      res.json({ success: true, history, count: history.length });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  إعدادات الانضمام
  // ══════════════════════════════════════════════════════════════════════════
  async getJoinSettings(req, res) {
    try {
      const { accountId } = req.params;
      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);

      let settings = await accountDB.get(`SELECT * FROM link_join_settings WHERE id = 'default'`);
      if (!settings) {
        await accountDB.run(`INSERT INTO link_join_settings (id) VALUES ('default') ON CONFLICT DO NOTHING`);
        settings = await accountDB.get(`SELECT * FROM link_join_settings WHERE id = 'default'`);
      }
      res.json({ success: true, settings });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async updateJoinSettings(req, res) {
    try {
      const { accountId } = req.params;
      const {
        delay_between_joins_sec = 30,
        random_delay_enabled    = false,
        random_delay_max_sec    = 60,
        max_retries             = 2,
        max_joins_per_hour      = 20,
        max_joins_per_day       = 100,
        skip_duplicates         = true,
        skip_disabled           = true,
      } = req.body;

      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);

      await accountDB.run(
        `INSERT INTO link_join_settings
         (id, delay_between_joins_sec, random_delay_enabled, random_delay_max_sec,
          max_retries, max_joins_per_hour, max_joins_per_day, skip_duplicates, skip_disabled, updated_at)
         VALUES ('default', $1,$2,$3,$4,$5,$6,$7,$8, NOW())
         ON CONFLICT (id) DO UPDATE SET
           delay_between_joins_sec = EXCLUDED.delay_between_joins_sec,
           random_delay_enabled    = EXCLUDED.random_delay_enabled,
           random_delay_max_sec    = EXCLUDED.random_delay_max_sec,
           max_retries             = EXCLUDED.max_retries,
           max_joins_per_hour      = EXCLUDED.max_joins_per_hour,
           max_joins_per_day       = EXCLUDED.max_joins_per_day,
           skip_duplicates         = EXCLUDED.skip_duplicates,
           skip_disabled           = EXCLUDED.skip_disabled,
           updated_at              = NOW()`,
        [delay_between_joins_sec, random_delay_enabled, random_delay_max_sec,
         max_retries, max_joins_per_hour, max_joins_per_day, skip_duplicates, skip_disabled]
      );

      res.json({ success: true, message: 'تم حفظ إعدادات الانضمام' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  تصدير الروابط المكتشفة CSV
  // ══════════════════════════════════════════════════════════════════════════
  async exportDiscoveredCSV(req, res) {
    try {
      const { accountId } = req.params;
      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);

      const links = await accountDB.all(
        `SELECT url, group_name, link_type, status, join_attempts, discovered_at
         FROM discovered_links ORDER BY discovered_at DESC LIMIT 10000`
      );

      const header = 'URL,GroupName,Type,Status,JoinAttempts,DiscoveredAt\n';
      const rows = links.map(l =>
        [l.url, `"${(l.group_name||'').replace(/"/g,'""')}"`, l.link_type, l.status, l.join_attempts, l.discovered_at].join(',')
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=discovered_links_${accountId}.csv`);
      res.send('\uFEFF' + header + rows);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async exportDiscovered(req, res) {
    try {
      const { accountId } = req.params; const format = String(req.params.format || req.query.format || 'csv').toLowerCase();
      const accountDB = await DatabaseManager.getAccountDB(accountId); await this._ensureTables(accountDB);
      const links = await accountDB.all(`SELECT url, normalized_url, url_hash, group_name, link_type, status, verification_status, discovered_by_account, discovered_at, last_seen_at, scan_id FROM discovered_links ORDER BY discovered_at DESC LIMIT 10000`);
      if (format === 'json') { res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename=discovered_links_${accountId}.json`); return res.json({ success:true, links }); }
      if (format === 'txt') { res.setHeader('Content-Type','text/plain; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename=discovered_links_${accountId}.txt`); return res.send(links.map(l=>l.url).join('\\n')); }
      const header='URL,NormalizedURL,Hash,GroupName,Type,Status,Verification,Account,DiscoveredAt,LastSeen,ScanID\\n'; const rows=links.map(l=>[l.url,l.normalized_url||'',l.url_hash||'',`"${String(l.group_name||'').replace(/"/g,'""')}"`,l.link_type,l.status,l.verification_status||'',l.discovered_by_account||'',l.discovered_at||'',l.last_seen_at||'',l.scan_id||''].join(',')).join('\\n');
      res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename=discovered_links_${accountId}.csv`); return res.send('\\uFEFF'+header+rows);
    } catch (err) { res.status(500).json({success:false,error:'تعذر تصدير نتائج مراقبة الروابط'}); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  تنظيف الروابط المعطلة/القديمة
  // ══════════════════════════════════════════════════════════════════════════
  async cleanupDisabledLinks(req, res) {
    try {
      const { accountId } = req.params;
      const accountDB = await DatabaseManager.getAccountDB(accountId);
      await this._ensureTables(accountDB);

      const result = await accountDB.run(
        `DELETE FROM discovered_links WHERE status IN ('disabled', 'blocked') AND updated_at < NOW() - INTERVAL '7 days'`
      );
      const deleted = result?.rowCount || result?.changes || 0;
      res.json({ success: true, deleted, message: `تم حذف ${deleted} رابط معطل قديم` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new LinkScanController();
