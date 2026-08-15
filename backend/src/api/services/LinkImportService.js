const DatabaseManager = require('../../database/DatabaseManager');
const WhatsAppManager = require('../../bot/WhatsAppManager');
const GroupJoinerService = require('./GroupJoinerService');
const { randomUUID } = require('crypto');

const jobs = new Map();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function normaliseUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;
  const match = url.match(/https?:\/\/[^\s]+/i);
  if (!match) return null;
  return match[0].replace(/[),.;]+$/, '');
}
function inviteCode(url) {
  return String(url || '').match(/(?:chat\.whatsapp\.com\/|whatsapp\.com\/invite\/)([A-Za-z0-9_-]{10,})/i)?.[1] || null;
}
function extractInboundValues(content, fileName = '') {
  const raw = String(content || '');
  const ext = String(fileName).toLowerCase().split('.').pop();
  if (ext === 'json') {
    try {
      const parsed = JSON.parse(raw); const values = [];
      const walk = (value) => { if (typeof value === 'string') values.push(value); else if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') Object.values(value).forEach(walk); };
      walk(parsed); return values;
    } catch { return raw.split(/\r?\n/); }
  }
  if (ext === 'csv') return raw.split(/\r?\n/).flatMap(line => line.split(/[;,\t]/));
  return raw.split(/\r?\n/);
}

class LinkImportService {
  async importFile({ accountId, fileName, content }) {
    const db = await DatabaseManager.getAccountDB(accountId);
    const seen = new Set(); const links = []; let duplicateCount = 0; let invalidCount = 0;
    for (const line of extractInboundValues(content, fileName)) {
      const url = normaliseUrl(line);
      if (!url || !inviteCode(url)) { if (line.trim()) invalidCount++; continue; }
      const key = url.toLowerCase();
      if (seen.has(key)) { duplicateCount++; continue; }
      seen.add(key); links.push(url);
    }
    const file = await db.query(`INSERT INTO link_import_files(file_name,file_size,total_links,valid_links,duplicate_links,invalid_links,status) VALUES($1,$2,$3,$4,$5,$6,'ready') RETURNING *`, [fileName || 'links.txt', Buffer.byteLength(String(content || ''), 'utf8'), links.length + duplicateCount + invalidCount, links.length, duplicateCount, invalidCount]);
    for (let i = 0; i < links.length; i += 100) {
      const chunk = links.slice(i, i + 100);
      for (const url of chunk) await db.query(`INSERT INTO link_import_items(file_id,url,status) VALUES($1,$2,'pending') ON CONFLICT(file_id,url) DO NOTHING`, [file.rows[0].id, url]);
    }
    return { file: file.rows[0], preview: links.slice(0, 100).map((url, i) => ({ index: i + 1, url, status: 'pending' })) };
  }

  async listFiles(accountId) {
    const db = await DatabaseManager.getAccountDB(accountId);
    const r = await db.query('SELECT * FROM link_import_files ORDER BY created_at DESC LIMIT 100'); return r.rows;
  }
  async getFile(accountId, fileId) {
    const db = await DatabaseManager.getAccountDB(accountId);
    const [f, items] = await Promise.all([db.query('SELECT * FROM link_import_files WHERE id=$1', [fileId]), db.query('SELECT * FROM link_import_items WHERE file_id=$1 ORDER BY id LIMIT 500', [fileId])]);
    return { file: f.rows[0] || null, items: items.rows };
  }
  async accounts(accountId) {
    const db = await DatabaseManager.getAccountDB(accountId);
    const r = await db.query(`SELECT id,name,phone_number,status FROM accounts WHERE id IS NOT NULL`, []);
    return r.rows.map(a => ({ ...a, connected: WhatsAppManager.isReady(a.id), activeJobs: [...jobs.values()].filter(j => j.accountIds.includes(a.id) && ['running','paused'].includes(j.status)).length }));
  }
  async start({ accountId, fileId, accountIds, minDelay, maxDelay, distributionMode }) {
    const selected = [...new Set(accountIds || [])].filter(id => WhatsAppManager.isReady(id));
    if (!selected.length) throw new Error('لا يوجد حساب متصل وجاهز للعمل');
    const db = await DatabaseManager.getAccountDB(accountId);
    const existing = [...jobs.values()].find(j => j.accountId === accountId && ['running','paused'].includes(j.status));
    if (existing) throw new Error('توجد عملية تشغيل نشطة لهذا الحساب');
    const rows = await db.query(`SELECT id,url FROM link_import_items WHERE file_id=$1 AND status IN ('pending','retry') ORDER BY id`, [fileId]);
    if (!rows.rows.length) throw new Error('لا توجد روابط قابلة للمعالجة');
    const job = { id: randomUUID(), accountId, fileId, accountIds: selected, status: 'running', total: rows.rows.length, processed: 0, successful: 0, failed: 0, skipped: 0, minDelay: Math.max(0, Number(minDelay) || 30), maxDelay: Math.max(Number(minDelay) || 30, Number(maxDelay) || Number(minDelay) || 30), distributionMode: distributionMode || 'round_robin', startedAt: new Date().toISOString(), lastError: null };
    jobs.set(job.id, job);
    await db.query(`UPDATE link_import_files SET status='running', operation_id=$2, started_at=NOW() WHERE id=$1`, [fileId, job.id]);
    this._run(job, rows.rows).catch(err => { job.status = 'error'; job.lastError = err.message; });
    return job;
  }
  async _run(job, rows) {
    const db = await DatabaseManager.getAccountDB(job.accountId);
    for (let i = 0; i < rows.length; i++) {
      while (job.status === 'paused') await sleep(500);
      if (job.status === 'stopped') break;
      const row = rows[i]; const accountId = job.accountIds[i % job.accountIds.length];
      if (!WhatsAppManager.isReady(accountId)) { job.skipped++; await db.query(`UPDATE link_import_items SET status='skipped',assigned_account_id=$2,processed_at=NOW(),result='account_offline' WHERE id=$1`, [row.id, accountId]); continue; }
      await db.query(`UPDATE link_import_items SET status='processing',assigned_account_id=$2,started_at=NOW() WHERE id=$1`, [row.id, accountId]);
      try {
        const result = await GroupJoinerService._doJoin(accountId, row.url);
        if (result.success) { job.successful++; await db.query(`UPDATE link_import_items SET status='success',result=$2,processed_at=NOW() WHERE id=$1`, [row.id, JSON.stringify(result)]); }
        else { job.failed++; await db.query(`UPDATE link_import_items SET status='failed',result=$2,processed_at=NOW() WHERE id=$1`, [row.id, JSON.stringify(result)]); }
      } catch (e) { job.failed++; await db.query(`UPDATE link_import_items SET status='failed',result=$2,processed_at=NOW() WHERE id=$1`, [row.id, JSON.stringify({ error: e.message })]); }
      job.processed++;
      if (i < rows.length - 1) { const delay = (job.minDelay === job.maxDelay ? job.minDelay : job.minDelay + Math.random() * (job.maxDelay - job.minDelay)); await sleep(delay * 1000); }
    }
    job.status = job.status === 'stopped' ? 'stopped' : 'completed';
    await db.query(`UPDATE link_import_files SET status=$2,processed_links=$3,completed_at=NOW() WHERE id=$1`, [job.fileId, job.status, job.processed]);
  }
  getJob(accountId, jobId) { const job = jobs.get(jobId); return job && job.accountId === accountId ? job : null; }
  pause(accountId, jobId) { const j = this.getJob(accountId, jobId); if (!j) throw new Error('العملية غير موجودة'); j.status = 'paused'; return j; }
  resume(accountId, jobId) { const j = this.getJob(accountId, jobId); if (!j) throw new Error('العملية غير موجودة'); j.status = 'running'; return j; }
  stop(accountId, jobId) { const j = this.getJob(accountId, jobId); if (!j) throw new Error('العملية غير موجودة'); j.status = 'stopped'; return j; }
}
module.exports = new LinkImportService();
module.exports.normaliseUrl = normaliseUrl;
module.exports.inviteCode = inviteCode;
module.exports.extractInboundValues = extractInboundValues;
