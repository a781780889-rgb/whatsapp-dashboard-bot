'use strict';
const SystemDB = require('../../database/SystemDB');
const WhatsAppManager = require('../../bot/WhatsAppManager');
const SocketBridge = require('../../core/SocketBridge');

const POLL_MS = 900;
const MAX_ATTEMPTS = 3;
let timer = null;
let running = false;

const COUNTRY_RULES = [
  ['+966','966','السعودية',true], ['+967','967','اليمن',false], ['+971','971','الإمارات',false],
  ['+965','965','الكويت',false], ['+974','974','قطر',false], ['+973','973','البحرين',false],
  ['+968','968','عمان',false], ['+20','20','مصر',false], ['+962','962','الأردن',false],
  ['+964','964','العراق',false], ['+90','90','تركيا',false],
];

function normalizePhone(value) {
  let raw = String(value || '').trim();
  if (!raw || raw.includes('@lid')) return null;
  raw = raw.replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (!raw.startsWith('+')) raw = `+${raw}`;
  const digits = raw.slice(1).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}
function classify(phone) {
  const rule = COUNTRY_RULES.find(([prefix]) => phone.startsWith(prefix));
  return rule ? { country_code: rule[1], country_name: rule[2], is_saudi: rule[3] } : { country_code: null, country_name: 'أخرى', is_saudi: false };
}
async function emit(event, payload) { try { SocketBridge.to(`user:${payload.userId}`).emit(event, payload); } catch {} }
async function activity(job, type, message, payload = {}) {
  await SystemDB.run(`INSERT INTO group_number_activity(job_id,user_id,account_id,group_jid,event_type,message,payload) VALUES($1,$2,$3,$4,$5,$6,$7)`, [job.id, job.user_id, job.current_account_id || null, job.current_group_jid || null, type, message, JSON.stringify(payload)]);
  await emit('group_numbers:activity', { userId: job.user_id, jobId: job.id, event_type: type, message, payload, created_at: new Date().toISOString() });
}
async function updateJob(jobId, fields) {
  const keys = Object.keys(fields); if (!keys.length) return;
  const values = Object.values(fields); const set = keys.map((k, i) => `${k}=$${i + 1}`).join(',');
  await SystemDB.run(`UPDATE group_number_jobs SET ${set},updated_at=NOW() WHERE id=$${values.length + 1}`, [...values, jobId]);
}

const GroupNumberService = {
  normalizePhone,
  classify,
  async createJob(userId, accountIds = []) {
    let ids = (Array.isArray(accountIds) ? accountIds : []).map(String).filter(Boolean);
    if (!ids.length) { const rows = await SystemDB.all(`SELECT id FROM accounts WHERE user_id=$1 AND status='connected' ORDER BY name`, [userId]); ids = rows.map(r => String(r.id)); }
    if (!ids.length) throw new Error('لا يوجد حساب واتساب متصل وجاهز لجمع أرقام المجموعات');
    const owned = await SystemDB.all(`SELECT id,status FROM accounts WHERE user_id=$1 AND id=ANY($2::uuid[])`, [userId, ids]);
    if (owned.length !== ids.length) throw new Error('أحد الحسابات المحددة غير مملوك للمستخدم أو غير موجود');
    const offline = owned.filter(a => a.status !== 'connected'); if (offline.length) throw new Error('يوجد حساب غير متصل ضمن الحسابات المحددة');
    const job = await SystemDB.get(`INSERT INTO group_number_jobs(user_id,account_ids,status,started_at) VALUES($1,$2,'queued',NOW()) RETURNING *`, [userId, JSON.stringify(ids)]);
    await activity(job, 'job_started', `تم إنشاء عملية جمع لأجل ${ids.length} حساب`, { account_ids: ids });
    return job;
  },
  async getJob(userId, jobId) { return SystemDB.get(`SELECT * FROM group_number_jobs WHERE id=$1 AND user_id=$2`, [jobId, userId]); },
  async getLatestJob(userId) { return SystemDB.get(`SELECT * FROM group_number_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [userId]); },
  async listJobs(userId, limit = 20) { return SystemDB.all(`SELECT * FROM group_number_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, Math.min(50, Number(limit) || 20)]); },
  async getActivity(userId, jobId, limit = 100) { return SystemDB.all(`SELECT * FROM group_number_activity WHERE user_id=$1 AND job_id=$2 ORDER BY created_at DESC LIMIT $3`, [userId, jobId, Math.min(300, Number(limit) || 100)]); },
  async getAccounts(userId) {
    const accounts = await SystemDB.all(`SELECT id,name,phone_number,status,health_status,updated_at FROM accounts WHERE user_id=$1 ORDER BY name`, [userId]);
    let counts = [];
    try { counts = await SystemDB.all(`SELECT account_id,COUNT(*)::int group_count FROM wa_groups WHERE account_id=ANY($1::uuid[]) GROUP BY account_id`, [accounts.map(a => a.id)]); } catch (_) {}
    const map = new Map(counts.map(c => [String(c.account_id), Number(c.group_count || 0)]));
    return accounts.map(a => ({ ...a, group_count: map.get(String(a.id)) || 0 }));
  },
  async listNumbers(userId, query = {}) {
    const page = Math.max(1, Number(query.page) || 1), limit = query.exportAll ? 100000 : Math.min(100, Math.max(1, Number(query.limit) || 50));
    const where = ['n.user_id=$1']; const values = [userId]; let i = 2;
    if (query.search) { const p = `$${i++}`; values.push(`%${query.search}%`); where.push(`(n.normalized_phone ILIKE ${p} OR COALESCE(n.country_name,'') ILIKE ${p})`); }
    if (query.saudi === 'true') where.push('n.is_saudi=TRUE');
    if (query.saudi === 'false') where.push('n.is_saudi=FALSE');
    if (query.admin === 'true') where.push('n.is_admin=TRUE');
    if (query.admin === 'false') where.push('n.is_admin=FALSE');
    if (query.country) { where.push(`n.country_code=$${i++}`); values.push(query.country); }
    const clause = where.join(' AND ');
    const total = await SystemDB.get(`SELECT COUNT(*) FROM group_numbers n WHERE ${clause}`, values);
    const limitPlaceholder = `$${i++}`, offsetPlaceholder = `$${i++}`;
    const pagedValues = [...values, limit, (page - 1) * limit];
    const rows = await SystemDB.all(`SELECT n.*,COALESCE(s.sources,0)::int sources FROM group_numbers n LEFT JOIN (SELECT number_id,COUNT(*) sources FROM group_number_sources GROUP BY number_id) s ON s.number_id=n.id WHERE ${clause} ORDER BY n.is_saudi DESC,n.updated_at DESC LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`, pagedValues);
    return { rows, total: Number(total?.count || 0), page, pages: Math.ceil(Number(total?.count || 0) / limit) };
  },
  async stats(userId) { const row = await SystemDB.get(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE is_saudi)::int saudi,COUNT(*) FILTER(WHERE NOT is_saudi)::int other,COUNT(*) FILTER(WHERE is_admin)::int admins FROM group_numbers WHERE user_id=$1`, [userId]); const groups = await SystemDB.get(`SELECT COUNT(DISTINCT group_jid)::int groups FROM group_number_sources WHERE user_id=$1`, [userId]); return { ...row, groups: Number(groups?.groups || 0) }; },
  async control(userId, jobId, action) { const job = await this.getJob(userId, jobId); if (!job) throw new Error('العملية غير موجودة'); const status = action === 'pause' ? 'paused' : action === 'resume' ? 'queued' : action === 'cancel' ? 'cancelled' : null; if (!status) throw new Error('إجراء غير صالح'); await updateJob(jobId, { status, error: null }); await activity({ ...job, status }, action, action === 'pause' ? 'تم إيقاف العملية مؤقتاً' : action === 'resume' ? 'تم استكمال العملية' : 'تم إيقاف العملية نهائياً'); return this.getJob(userId, jobId); },
  async _saveMember(job, accountId, group, member) {
    const phone = normalizePhone(member.phone); if (!phone) return { ignored: true };
    const c = classify(phone); const existing = await SystemDB.get(`INSERT INTO group_numbers(user_id,normalized_phone,country_code,country_name,is_saudi,contact_name,is_admin,appearance_count,source_count) VALUES($1,$2,$3,$4,$5,$6,$7,1,1) ON CONFLICT(user_id,normalized_phone) DO UPDATE SET last_seen_at=NOW(),appearance_count=group_numbers.appearance_count+1,source_count=group_numbers.source_count+1,is_admin=group_numbers.is_admin OR EXCLUDED.is_admin,contact_name=COALESCE(group_numbers.contact_name,EXCLUDED.contact_name),updated_at=NOW() RETURNING *`, [job.user_id, phone, c.country_code, c.country_name, c.is_saudi, member.name || null, !!member.is_admin]);
    await SystemDB.run(`INSERT INTO group_number_sources(number_id,user_id,account_id,group_jid,group_name,is_admin) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(number_id,account_id,group_jid) DO UPDATE SET last_seen_at=NOW(),is_admin=group_number_sources.is_admin OR EXCLUDED.is_admin`, [existing.id, job.user_id, accountId, group.id, group.subject || group.name || null, !!member.is_admin]);
    return { number: existing, new: Number(existing.appearance_count) === 1, saudi: c.is_saudi, admin: !!member.is_admin };
  },
  async _runJob(job) {
    const ids = Array.isArray(job.account_ids) ? job.account_ids : JSON.parse(job.account_ids || '[]');
    await updateJob(job.id, { status: 'running', started_at: job.started_at || new Date(), error: null });
    let groupsTotal = 0, groupsScanned = Number(job.groups_scanned || 0), raw = Number(job.raw_members || 0), dups = Number(job.duplicate_numbers || 0), saudi = Number(job.saudi_numbers || 0), admins = Number(job.admin_numbers || 0), errors = Number(job.errors_count || 0);
    for (const accountId of ids) {
      if (!(await this.getJob(job.user_id, job.id))?.status || (await this.getJob(job.user_id, job.id)).status === 'cancelled') return;
      let groups;
      try { groups = await WhatsAppManager.getGroups(accountId); } catch (e) { errors++; await activity({ ...job, current_account_id: accountId }, 'error', `تعذر جلب مجموعات الحساب: ${e.message}`); continue; }
      groupsTotal += groups.length; await updateJob(job.id, { current_account_id: accountId, groups_total: groupsTotal });
      for (const group of groups) {
        const latest = await this.getJob(job.user_id, job.id); if (!latest || latest.status === 'cancelled') return; if (latest.status === 'paused') return;
        const groupJid = group.id || group.jid; await updateJob(job.id, { current_account_id: accountId, current_group_jid: groupJid });
        try {
          const members = await WhatsAppManager.getGroupMembers(accountId, groupJid); const list = members?.all || [];
          raw += list.length; let added = 0;
          for (const m of list) { const result = await this._saveMember(job, accountId, group, m); if (result.ignored) continue; if (result.new) added++; else dups++; if (result.saudi) saudi++; if (result.admin) admins++; }
          groupsScanned++; await activity({ ...job, current_account_id: accountId, current_group_jid: groupJid }, 'group_scanned', `تم فحص المجموعة ${group.subject || group.name || groupJid}`, { members: list.length, new_numbers: added, saudi, admins });
        } catch (e) { errors++; await activity({ ...job, current_account_id: accountId, current_group_jid: groupJid }, 'error', `تعذر فحص المجموعة ${group.subject || groupJid}: ${e.message}`); }
        const current = await this.stats(job.user_id); await updateJob(job.id, { groups_scanned: groupsScanned, raw_members: raw, duplicate_numbers: dups, saudi_numbers: current.saudi, admin_numbers: current.admins, unique_numbers: current.total, errors_count: errors }); await emit('group_numbers:update', { userId: job.user_id, jobId: job.id, status: 'running', groups_total: groupsTotal, groups_scanned: groupsScanned, unique_numbers: current.total, saudi_numbers: current.saudi, admin_numbers: current.admins, errors_count: errors });
      }
    }
    await updateJob(job.id, { status: 'completed', finished_at: new Date(), groups_total: groupsTotal, groups_scanned: groupsScanned, raw_members: raw, duplicate_numbers: dups, errors_count: errors, unique_numbers: (await this.stats(job.user_id)).total });
    await activity({ ...job }, 'job_completed', 'اكتملت عملية جمع أرقام المجموعات', { groups_scanned: groupsScanned, errors });
    await emit('group_numbers:update', { userId: job.user_id, jobId: job.id, status: 'completed' });
  },
  async _tick() { if (running) return; running = true; try { const job = await SystemDB.get(`SELECT * FROM group_number_jobs WHERE status='queued' ORDER BY created_at LIMIT 1`); if (job) await this._runJob(job); } catch (e) { console.error('[GroupNumberWorker]', e.message); } finally { running = false; } },
  async startWorker() { if (timer) return; await SystemDB.run(`UPDATE group_number_jobs SET status='queued',updated_at=NOW() WHERE status='running'`).catch(() => {}); timer = setInterval(() => this._tick().catch(() => {}), POLL_MS); timer.unref?.(); await this._tick(); console.log('[GroupNumberWorker] started'); },
  stopWorker() { if (timer) clearInterval(timer); timer = null; },
  getCountryRules() { return COUNTRY_RULES.map(x => ({ code: x[1], name: x[2], saudi: x[3] })); },
};
module.exports = GroupNumberService;
