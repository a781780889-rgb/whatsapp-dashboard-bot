'use strict';

const AdmZip = require('adm-zip');
const { randomUUID } = require('crypto');
const { query, queryOne, queryAll } = require('../../lib/postgres');
const { getRedis } = require('../../lib/redis');
const QueueManager = require('../../lib/QueueManager');
const SocketBridge = require('../../core/SocketBridge');
function getGroupJoinerService() { return require('./GroupJoinerService'); }
const LinkUrlProcessingService = require('./LinkUrlProcessingService');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_XML_BYTES = 40 * 1024 * 1024;
const ACCOUNT_LOCK_TTL_MS = 120000;
const fallbackLocks = new Map();

function userRoom(userId) { return `user:${userId}`; }
function emit(userId, event, payload) { SocketBridge.to(userRoom(userId)).emit(event, payload); }
function nowIso() { return new Date().toISOString(); }
function cleanXmlText(xml) {
  return String(xml || '')
    .replace(/<w:tab\s*\/?\s*>/gi, ' ')
    .replace(/<w:br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function extractDocxLinks(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter(entry => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(entry.entryName));
  let totalXmlBytes = 0;
  const text = entries.map(entry => {
    const data = entry.getData();
    totalXmlBytes += data.length;
    if (totalXmlBytes > MAX_XML_BYTES) throw new Error('محتوى Word غير آمن أو يتجاوز الحد المسموح');
    return cleanXmlText(data.toString('utf8'));
  }).join('\n');
  return text.match(/https?:\/\/[^\s<>"'«»]+/gi) || [];
}

function parseDocx(buffer, filename) {
  if (!/\.docx$/i.test(filename || '')) throw new Error('الصيغة المدعومة حاليًا هي .docx فقط؛ ملف .doc غير مدعوم بشكل موثوق');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('الملف فارغ');
  if (buffer.length > MAX_FILE_BYTES) throw new Error('حجم الملف يتجاوز الحد المسموح 10MB');
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('الملف ليس حاوية DOCX صالحة');
  // DOCX is an OOXML ZIP container. Reject malformed containers before parsing.
  try { return extractDocxLinks(buffer); } catch (error) { throw new Error(`تعذر قراءة ملف Word: ${error.message}`); }
}

function parseImportedLinks(rawLinks) {
  const parsed = LinkUrlProcessingService.parseMany(rawLinks);
  const duplicateInFile = Math.max(0, rawLinks.length - parsed.length);
  const valid = parsed.filter(item => item.ok);
  const review = parsed.filter(item => !item.ok && item.code === 'UNSUPPORTED_LINK');
  const invalid = parsed.filter(item => !item.ok && item.code !== 'UNSUPPORTED_LINK');
  return { parsed, valid, review, invalid, duplicateInFile };
}

async function acquireAccountLock(accountId) {
  const key = `wa:link-import:account:${accountId}`;
  try {
    const redis = getRedis();
    const acquired = await redis.set(key, process.pid.toString(), 'PX', ACCOUNT_LOCK_TTL_MS, 'NX');
    if (acquired === 'OK') return { release: async () => { try { await redis.del(key); } catch (_) {} } };
    return null;
  } catch (_) {
    const current = fallbackLocks.get(accountId);
    if (current && current > Date.now()) return null;
    fallbackLocks.set(accountId, Date.now() + ACCOUNT_LOCK_TTL_MS);
    return { release: async () => fallbackLocks.delete(accountId) };
  }
}

async function recordEvent({ userId, taskId, operationId = null, accountId = null, linkId = null, eventType, payload = {} }) {
  await query(`INSERT INTO link_import_events (user_id,task_id,operation_id,account_id,link_id,event_type,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [userId, taskId, operationId, accountId, linkId, eventType, JSON.stringify(payload)]).catch(() => {});
  emit(userId, 'link_import:event', { taskId, operationId, accountId, linkId, eventType, payload, at: nowIso() });
}

async function importDocx({ userId, filename, contentBase64 }) {
  const started = Date.now();
  if (!userId) throw new Error('المستخدم غير معروف');
  const buffer = Buffer.from(String(contentBase64 || ''), 'base64');
  const rawLinks = parseDocx(buffer, filename);
  const parsed = parseImportedLinks(rawLinks);
  const source = await queryOne(`INSERT INTO link_import_sources (user_id,filename,file_size_bytes,total_found,duplicate_count,invalid_count,review_count,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'processing') RETURNING id`, [userId, filename, buffer.length, rawLinks.length, parsed.duplicateInFile, parsed.invalid.length, parsed.review.length]);
  let newCount = 0;
  let existingCount = 0;
  for (const item of parsed.valid) {
    const row = await query(`INSERT INTO link_import_links (id,user_id,source_id,url,canonical_url,invite_code,validation_status) VALUES ($1,$2,$3,$4,$5,$6,'valid') ON CONFLICT (user_id,canonical_url) DO NOTHING`, [randomUUID(), userId, source.id, item.originalUrl, item.canonicalUrl, item.inviteCode]);
    if (row.rowCount) newCount++; else existingCount++;
  }
  const processingMs = Date.now() - started;
  await query(`UPDATE link_import_sources SET new_count=$1,duplicate_count=$2,processing_ms=$3,status='completed' WHERE id=$4`, [newCount, existingCount + parsed.duplicateInFile, processingMs, source.id]);
  const summary = { sourceId: source.id, filename, total: rawLinks.length, newCount, duplicateCount: existingCount + parsed.duplicateInFile, invalidCount: parsed.invalid.length, reviewCount: parsed.review.length, processingMs, status: 'completed' };
  emit(userId, 'link_import:source_completed', summary);
  return summary;
}

async function listLinks(userId, queryParams = {}) {
  const search = String(queryParams.search || '').trim();
  const status = String(queryParams.status || '').trim();
  const params = [userId]; const conditions = ['l.user_id=$1'];
  if (search) { params.push(`%${search}%`); conditions.push(`l.canonical_url ILIKE $${params.length}`); }
  if (status) { params.push(status); conditions.push(`COALESCE(l.last_status,'pending')=$${params.length}`); }
  return queryAll(`SELECT l.*, s.filename source_filename FROM link_import_links l LEFT JOIN link_import_sources s ON s.id=l.source_id WHERE ${conditions.join(' AND ')} ORDER BY l.created_at DESC LIMIT 500`, params);
}

async function ownedAccounts(userId, accountIds) {
  if (!Array.isArray(accountIds) || accountIds.length === 0) throw new Error('اختر حسابًا واحدًا على الأقل');
  const uniqueIds = [...new Set(accountIds.map(String))];
  const accounts = await queryAll(`SELECT id,name,status,health_status,task_status,connection_type FROM accounts WHERE user_id=$1 AND id=ANY($2::uuid[])`, [userId, uniqueIds]);
  if (accounts.length !== uniqueIds.length) throw new Error('يوجد حساب غير مملوك للمستخدم الحالي');
  return accounts;
}

async function createTask({ userId, linkIds, accountIds, settings = {} }) {
  const accounts = await ownedAccounts(userId, accountIds);
  const ids = [...new Set((linkIds || []).map(String))];
  if (!ids.length) throw new Error('اختر رابطًا واحدًا على الأقل');
  const links = await queryAll(`SELECT id,canonical_url FROM link_import_links WHERE user_id=$1 AND id=ANY($2::uuid[]) AND validation_status='valid'`, [userId, ids]);
  if (links.length !== ids.length) throw new Error('بعض الروابط غير صالحة أو لا تنتمي للمستخدم الحالي');
  const minDelay = Math.max(0, Math.min(86400, Number(settings.minDelaySeconds ?? 60)));
  const maxDelay = Math.max(minDelay, Math.min(86400, Number(settings.maxDelaySeconds ?? 180)));
  const maxRetries = Math.max(0, Math.min(3, Number(settings.maxRetries ?? 2)));
  const task = await queryOne(`INSERT INTO link_import_tasks (user_id,status,min_delay_seconds,max_delay_seconds,max_retries,total_operations) VALUES ($1,'pending',$2,$3,$4,$5) RETURNING *`, [userId, minDelay, maxDelay, maxRetries, accounts.length * links.length]);
  const operations = [];
  for (const account of accounts) {
    for (const link of links) {
      const op = await queryOne(`INSERT INTO link_import_operations (task_id,user_id,account_id,link_id,status) VALUES ($1,$2,$3,$4,'pending') ON CONFLICT (task_id,account_id,link_id) DO NOTHING RETURNING id`, [task.id, userId, account.id, link.id]);
      if (op) operations.push({ operationId: op.id, accountId: account.id, linkId: link.id });
    }
  }
  for (const [index, operation] of operations.entries()) {
    const delayRange = maxDelay - minDelay;
    const delaySeconds = minDelay + (delayRange ? Math.floor(Math.random() * (delayRange + 1)) : 0);
    await QueueManager.enqueueLinkImportOperation(operation, { delay: index === 0 ? 0 : delaySeconds * 1000, attempts: 1 });
  }
  await recordEvent({ userId, taskId: task.id, eventType: 'task_created', payload: { accounts: accounts.length, links: links.length, operations: operations.length } });
  return { task, accountsCount: accounts.length, linksCount: links.length, totalOperations: operations.length };
}

async function taskDashboard(userId, taskId) {
  const task = await queryOne(`SELECT * FROM link_import_tasks WHERE id=$1 AND user_id=$2`, [taskId, userId]);
  if (!task) return null;
  const operations = await queryAll(`SELECT o.*, a.name account_name, l.canonical_url url FROM link_import_operations o JOIN accounts a ON a.id=o.account_id JOIN link_import_links l ON l.id=o.link_id WHERE o.task_id=$1 ORDER BY a.name,l.created_at`, [taskId]);
  const events = await queryAll(`SELECT * FROM link_import_events WHERE task_id=$1 ORDER BY created_at DESC LIMIT 100`, [taskId]);
  const stats = operations.reduce((acc, item) => { acc.total++; acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, { total: 0, pending: 0, processing: 0, success: 0, failed: 0, retry: 0, paused: 0, skipped: 0, review: 0 });
  const terminal = stats.success + stats.failed + stats.skipped + stats.review;
  return { task, operations, events, stats, progress: stats.total ? Math.round((terminal / stats.total) * 100) : 0 };
}

async function updateTaskStatus(userId, taskId, status) {
  if (!['pending', 'paused', 'stopped'].includes(status)) throw new Error('حالة المهمة غير مدعومة');
  const task = await queryOne(`UPDATE link_import_tasks SET status=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *`, [status, taskId, userId]);
  if (!task) throw new Error('المهمة غير موجودة');
  if (status === 'stopped') await query(`UPDATE link_import_operations SET status='skipped',completed_at=NOW(),updated_at=NOW(),last_error='تم إيقاف المهمة يدويًا' WHERE task_id=$1 AND status IN ('pending','retry','paused')`, [taskId]);
  if (status === 'pending') {
    const pending = await queryAll(`SELECT id operation_id,account_id,link_id FROM link_import_operations WHERE task_id=$1 AND status IN ('pending','retry','paused') ORDER BY created_at`, [taskId]);
    for (const operation of pending) await QueueManager.enqueueLinkImportOperation(operation, { attempts: 1, delay: 0, jobId: `link-import:resume:${operation.operation_id}:${Date.now()}` });
  }
  await recordEvent({ userId, taskId, eventType: `task_${status}`, payload: {} });
  return task;
}

async function processOperation({ operationId, accountId, linkId }) {
  const operation = await queryOne(`SELECT o.*, t.status task_status,t.max_retries,t.user_id,t.min_delay_seconds,t.max_delay_seconds,l.canonical_url url FROM link_import_operations o JOIN link_import_tasks t ON t.id=o.task_id JOIN link_import_links l ON l.id=o.link_id WHERE o.id=$1`, [operationId]);
  if (!operation) return;
  if (operation.task_status === 'paused') { await query(`UPDATE link_import_operations SET status='paused',updated_at=NOW() WHERE id=$1 AND status IN ('pending','retry')`, [operationId]); return; }
  if (operation.task_status === 'stopped') { await query(`UPDATE link_import_operations SET status='skipped',completed_at=NOW(),updated_at=NOW() WHERE id=$1 AND status NOT IN ('success','failed','skipped')`, [operationId]); return; }
  if (['success','failed','skipped'].includes(operation.status)) return;
  const account = await queryOne(`SELECT id,status,health_status,task_status FROM accounts WHERE id=$1 AND user_id=$2`, [accountId, operation.user_id]);
  if (!account || account.status !== 'connected' || ['protected','blocked'].includes(account.health_status) || account.task_status === 'stopped') {
    await query(`UPDATE link_import_operations SET status='review',last_error='الحساب غير متصل أو محمي ويحتاج مراجعة',completed_at=NOW(),updated_at=NOW() WHERE id=$1`, [operationId]);
    await recordEvent({ userId: operation.user_id, taskId: operation.task_id, operationId, accountId, linkId, eventType: 'account_blocked', payload: { reason: 'account_not_ready' } });
    return;
  }
  const lock = await acquireAccountLock(accountId);
  if (!lock) { await QueueManager.enqueueLinkImportOperation({ operationId, accountId, linkId }, { delay: 5000, attempts: 1 }); return; }
  try {
    await query(`UPDATE link_import_operations SET status='processing',attempt_count=attempt_count+1,started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1`, [operationId]);
    await recordEvent({ userId: operation.user_id, taskId: operation.task_id, operationId, accountId, linkId, eventType: 'processing', payload: { attempt: operation.attempt_count + 1 } });
    let result;
    try { result = await getGroupJoinerService()._doJoin(accountId, operation.url); } catch (error) { result = { success: false, status: 'failed', retryable: false, error: error.message }; }
    const attempt = operation.attempt_count + 1;
    const protectedAccount = ['account_restricted', 'account_error'].includes(result.status) && !result.retryable;
    if (protectedAccount) {
      await query(`UPDATE accounts SET health_status='protected',task_status='stopped',updated_at=NOW() WHERE id=$1`, [accountId]);
      await query(`UPDATE link_import_operations SET status='review',last_error=$1,completed_at=NOW(),updated_at=NOW() WHERE task_id=$2 AND account_id=$3 AND status IN ('pending','retry','processing')`, [result.error || 'تم إيقاف الحساب للحماية', operation.task_id, accountId]);
    } else if (result.success) {
      await query(`UPDATE link_import_operations SET status='success',last_error=$1,completed_at=NOW(),updated_at=NOW() WHERE id=$2`, [result.status === 'already_joined' ? 'تمت المعالجة مسبقًا' : null, operationId]);
      await query(`UPDATE link_import_links SET last_status='success',last_error=NULL,updated_at=NOW() WHERE id=$1`, [linkId]);
    } else if (result.retryable && attempt <= operation.max_retries) {
      const retryDelay = Math.min(300000, 15000 * (2 ** Math.max(0, attempt - 1)));
      await query(`UPDATE link_import_operations SET status='retry',last_error=$1,next_retry_at=NOW()+($2 * INTERVAL '1 second'),updated_at=NOW() WHERE id=$3`, [result.error || 'خطأ مؤقت', Math.ceil(retryDelay / 1000), operationId]);
      await QueueManager.enqueueLinkImportOperation({ operationId, accountId, linkId }, { delay: retryDelay, attempts: 1 });
    } else {
      const finalStatus = result.retryable ? 'review' : 'failed';
      await query(`UPDATE link_import_operations SET status=$1,last_error=$2,completed_at=NOW(),updated_at=NOW() WHERE id=$3`, [finalStatus, result.error || 'فشلت العملية', operationId]);
      await query(`UPDATE link_import_links SET last_status=$1,last_error=$2,updated_at=NOW() WHERE id=$3`, [finalStatus, result.error || 'فشلت العملية', linkId]);
    }
    await recordEvent({ userId: operation.user_id, taskId: operation.task_id, operationId, accountId, linkId, eventType: 'result', payload: { status: result.success ? 'success' : result.status, error: result.error || null } });
    const pending = await queryOne(`SELECT COUNT(*)::int count FROM link_import_operations WHERE task_id=$1 AND status IN ('pending','processing','retry')`, [operation.task_id]);
    if (!pending?.count) await query(`UPDATE link_import_tasks SET status='completed',completed_at=NOW(),updated_at=NOW() WHERE id=$1 AND status <> 'stopped'`, [operation.task_id]);
  } finally { await lock.release(); }
}

module.exports = { importDocx, listLinks, createTask, taskDashboard, updateTaskStatus, processOperation, parseDocx, parseImportedLinks };
