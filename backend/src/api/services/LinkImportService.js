'use strict';

const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const { query, queryOne, queryAll } = require('../../lib/postgres');
const SocketBridge = require('../../core/SocketBridge');
const WhatsAppManager = require('../../bot/WhatsAppManager');
const GroupJoinerService = require('./GroupJoinerService');
const LinkUrlProcessingService = require('./LinkUrlProcessingService');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RETRIES = 3;
const queue = new Set();
let workerTimer = null;

function room(userId) { return `user:${userId}`; }
function emit(userId, event, payload) { SocketBridge.to(room(userId)).emit(event, payload); }
function cleanText(value) { return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&'); }

function extractDocxLinks(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter(entry => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(entry.entryName));
  const xml = entries.map(entry => entry.getData().toString('utf8')).join('\n');
  const text = cleanText(xml).replace(/<w:tab\/?\s*>/g, ' ').replace(/<w:br\/?\s*>/g, '\n');
  return text.match(/https?:\/\/[^\s<>"']+/gi) || [];
}

function canonicalize(raw) {
  const candidate = String(raw || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[.,;:!?؟،؛)\]}]+$/g, '');
  const parsed = LinkUrlProcessingService.parseSupportedUrl(candidate);
  return parsed?.canonicalUrl || null;
}

function validateLinks(rawLinks) {
  const seen = new Set();
  const links = [];
  let invalid = 0;
  let duplicate = 0;
  for (const raw of rawLinks) {
    const canonical = canonicalize(raw);
    if (!canonical) { invalid++; continue; }
    const key = canonical.toLowerCase();
    if (seen.has(key)) { duplicate++; continue; }
    seen.add(key); links.push({ url: canonical, raw });
  }
  return { links, invalid, duplicate };
}

async function assertOwned(userId, accountIds) {
  if (!accountIds?.length) throw new Error('اختر حساباً واحداً على الأقل');
  const rows = await queryAll(`SELECT id, name, status, health_status, task_status FROM accounts WHERE id = ANY($1::uuid[]) AND user_id = $2`, [accountIds, userId]);
  if (rows.length !== accountIds.length) throw new Error('يوجد حساب غير مملوك للمستخدم الحالي');
  return rows;
}

async function importDocx({ userId, filename, contentBase64 }) {
  if (!filename || !/\.docx$/i.test(filename)) throw new Error('يجب اختيار ملف Word بصيغة .docx');
  const buffer = Buffer.from(String(contentBase64 || ''), 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('الملف فارغ أو يتجاوز الحد المسموح 10MB');
  const rawLinks = extractDocxLinks(buffer);
  const parsed = validateLinks(rawLinks);
  let added = 0;
  for (const item of parsed.links) {
    const result = await query(`INSERT INTO imported_links (id, user_id, url, source_filename) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, url) DO NOTHING`, [uuidv4(), userId, item.url, filename]);
    if (result.rowCount) added++;
  }
  const summary = { filename, total: rawLinks.length, newLinks: added, duplicates: parsed.duplicate + (parsed.links.length - added), invalid: parsed.invalid, status: 'completed' };
  return summary;
}

async function createTask({ userId, linkIds, accountIds, settings = {} }) {
  const accounts = await assertOwned(userId, accountIds);
  const links = await queryAll(`SELECT id, url FROM imported_links WHERE user_id=$1 AND id = ANY($2::uuid[]) AND status <> 'invalid'`, [userId, linkIds]);
  if (!links.length) throw new Error('لا توجد روابط صالحة للتشغيل');
  const taskId = uuidv4();
  await query(`INSERT INTO link_import_tasks (id,user_id,status,min_delay_seconds,max_delay_seconds,max_retries) VALUES ($1,$2,'pending',$3,$4,$5)`, [taskId, userId, Math.max(0, Number(settings.minDelaySeconds ?? 60)), Math.max(0, Number(settings.maxDelaySeconds ?? 180)), Math.min(MAX_RETRIES, Math.max(0, Number(settings.maxRetries ?? 2))) ]);
  for (const account of accounts) {
    for (const link of links) {
      const row = await query(`INSERT INTO link_import_operations (id,task_id,user_id,account_id,link_id,status) VALUES ($1,$2,$3,$4,$5,'pending') ON CONFLICT (task_id,account_id,link_id) DO NOTHING`, [uuidv4(), taskId, userId, account.id, link.id]);
      if (row.rowCount) queue.add(taskId);
    }
  }
  await query(`UPDATE link_import_tasks SET total_operations=(SELECT COUNT(*) FROM link_import_operations WHERE task_id=$1) WHERE id=$1`, [taskId]);
  emit(userId, 'link_import:task_update', { taskId, status: 'pending' });
  return { taskId, accounts: accounts.length, links: links.length, totalOperations: accounts.length * links.length };
}

async function updateTaskStatus(taskId, userId, status) {
  const allowed = new Set(['paused', 'stopped', 'pending']);
  if (!allowed.has(status)) throw new Error('حالة غير مدعومة');
  await query(`UPDATE link_import_tasks SET status=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3`, [status, taskId, userId]);
  if (status === 'pending') queue.add(taskId);
  emit(userId, 'link_import:task_update', { taskId, status });
  return { success: true };
}

async function dashboard(userId, taskId) {
  const task = await queryOne(`SELECT * FROM link_import_tasks WHERE id=$1 AND user_id=$2`, [taskId, userId]);
  if (!task) return null;
  const operations = await queryAll(`SELECT o.*, a.name account_name, l.url FROM link_import_operations o JOIN accounts a ON a.id=o.account_id JOIN imported_links l ON l.id=o.link_id WHERE o.task_id=$1 ORDER BY a.name,l.created_at`, [taskId]);
  const stats = operations.reduce((acc, op) => { acc.total++; acc[op.status] = (acc[op.status] || 0) + 1; return acc; }, { total: 0, pending: 0, processing: 0, success: 0, failed: 0, retry: 0, review: 0, skipped: 0, paused: 0 });
  return { task, operations, stats, progress: stats.total ? Math.round(((stats.success + stats.failed + stats.review + stats.skipped) / stats.total) * 100) : 0 };
}

async function processOne(op) {
  const task = await queryOne(`SELECT * FROM link_import_tasks WHERE id=$1`, [op.task_id]);
  if (!task || task.status !== 'pending') return;
  const account = await queryOne(`SELECT id,status,health_status,task_status FROM accounts WHERE id=$1`, [op.account_id]);
  if (!account || account.status !== 'connected' || account.health_status === 'protected' || account.health_status === 'blocked') {
    await query(`UPDATE link_import_operations SET status='skipped',last_error=$1,completed_at=NOW() WHERE id=$2`, ['الحساب غير متصل أو متوقف للحماية', op.id]);
    return;
  }
  await query(`UPDATE link_import_operations SET status='processing',started_at=COALESCE(started_at,NOW()),attempt_count=attempt_count+1 WHERE id=$1`, [op.id]);
  emit(op.user_id, 'link_import:operation_update', { taskId: op.task_id, operationId: op.id, status: 'processing' });
  let result;
  try { result = await GroupJoinerService._doJoin(op.account_id, op.url); } catch (error) { result = { success: false, retryable: false, error: error.message }; }
  const finalStatus = result.success ? 'success' : (result.retryable && op.attempt_count < task.max_retries ? 'retry' : (result.retryable ? 'review' : 'failed'));
  await query(`UPDATE link_import_operations SET status=$1,last_error=$2,next_retry_at=$3,completed_at=$4 WHERE id=$5`, [finalStatus, result.error || null, finalStatus === 'retry' ? new Date(Date.now() + Math.min(300000, 15000 * Math.pow(2, op.attempt_count))).toISOString() : null, finalStatus === 'success' || finalStatus === 'failed' || finalStatus === 'review' ? new Date().toISOString() : null, op.id]);
  await query(`UPDATE imported_links SET last_status=$1,last_error=$2,updated_at=NOW() WHERE id=$3`, [finalStatus, result.error || null, op.link_id]);
  emit(op.user_id, 'link_import:operation_update', { taskId: op.task_id, operationId: op.id, status: finalStatus, error: result.error || null });
}

async function workerTick() {
  const tasks = await queryAll(`SELECT DISTINCT o.task_id FROM link_import_operations o JOIN link_import_tasks t ON t.id=o.task_id WHERE t.status='pending' AND (o.status='pending' OR (o.status='retry' AND (o.next_retry_at IS NULL OR o.next_retry_at <= NOW()))) LIMIT 20`).catch(() => []);
  for (const task of tasks) {
    const op = await queryOne(`SELECT * FROM link_import_operations WHERE task_id=$1 AND (status='pending' OR (status='retry' AND (next_retry_at IS NULL OR next_retry_at <= NOW()))) ORDER BY created_at LIMIT 1`, [task.task_id]);
    if (op) await processOne(op);
    const remaining = await queryOne(`SELECT COUNT(*)::int count FROM link_import_operations WHERE task_id=$1 AND status IN ('pending','processing','retry')`, [task.task_id]);
    if (!remaining?.count) {
      const user = await queryOne(`SELECT user_id FROM link_import_tasks WHERE id=$1`, [task.task_id]);
      await query(`UPDATE link_import_tasks SET status='completed',completed_at=NOW(),updated_at=NOW() WHERE id=$1`, [task.task_id]);
      if (user) emit(user.user_id, 'link_import:task_update', { taskId: task.task_id, status: 'completed' });
    }
  }
}

function startWorker() { if (workerTimer) return; workerTimer = setInterval(() => workerTick().catch(error => console.error('[LinkImportWorker]', error.message)), 2000); }
function stopWorker() { if (workerTimer) clearInterval(workerTimer); workerTimer = null; }

module.exports = { importDocx, createTask, updateTaskStatus, dashboard, startWorker, stopWorker, extractDocxLinks, validateLinks };
