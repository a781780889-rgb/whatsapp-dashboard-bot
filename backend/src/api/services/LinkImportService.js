const DatabaseManager = require('../../database/DatabaseManager');
const WhatsAppManager = require('../../bot/WhatsAppManager');
const GroupJoinerService = require('./GroupJoinerService');
const { getPool } = require('../../lib/postgres');
const { randomUUID } = require('crypto');
const AdmZip = require('adm-zip');
const SocketBridge = require('../../core/SocketBridge');

const jobs = new Map();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function normaliseUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;
  const match = url.match(/https?:\/\/[^\s]+/i);
  return match ? match[0].replace(/[),.;]+$/, '') : null;
}
function inviteCode(url) { return String(url || '').match(/(?:chat\.whatsapp\.com\/|whatsapp\.com\/invite\/)([A-Za-z0-9_-]{20,})/i)?.[1] || null; }
function extractDocxText(base64) {
  const zip = new AdmZip(Buffer.from(String(base64 || ''), 'base64')); const entries = zip.getEntries();
  const xmlParts = entries.filter(e => /^word\/(document|header|footer|footnotes|endnotes)\.xml$/i.test(e.entryName)).map(e => e.getData().toString('utf8'));
  if (!xmlParts.length) throw new Error('ملف Word لا يحتوي على مستند قابل للقراءة');
  const targets = entries.filter(e => /^word\//.test(e.entryName) && /\.rels$/i.test(e.entryName)).flatMap(e => [...e.getData().toString('utf8').matchAll(/Target=["'](https?:\/\/[^"']+)["']/gi)].map(m => m[1]));
  const text = xmlParts.join('\n').replace(/<w:tab\s*\/?/gi, '\t').replace(/<w:br\s*\/?/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
  const inline = [...xmlParts.join('\n').matchAll(/https?:\/\/[^\s"'<]+/gi)].map(m => m[0]);
  return [text, ...targets, ...inline].join('\n');
}
function extractInboundValues(content, fileName = '') {
  const ext = String(fileName).toLowerCase().split('.').pop();
  if (ext === 'docx') return [...new Set(extractDocxText(content).match(/https?:\/\/[^\s"'<]+/gi) || [])];
  const raw = String(content || '');
  if (ext === 'json') { try { const parsed = JSON.parse(raw); const values=[]; const walk=v=>{if(typeof v==='string')values.push(v); else if(Array.isArray(v))v.forEach(walk); else if(v&&typeof v==='object')Object.values(v).forEach(walk);}; walk(parsed); return values; } catch { return raw.split(/\r?\n/); } }
  if (ext === 'csv') return raw.split(/\r?\n/).flatMap(line => line.split(/[;,\t]/));
  return raw.split(/\r?\n/);
}

class LinkImportService {
  constructor() { this._workerTimer = null; this._workerBusy = false; }
  async importFile({ accountId, fileName, content }) {
    const db = await DatabaseManager.getAccountDB(accountId); const seen = new Set(); const links=[]; let duplicateCount=0; let invalidCount=0;
    for (const line of extractInboundValues(content, fileName)) { const url=normaliseUrl(line); if(!url||!inviteCode(url)){if(String(line).trim())invalidCount++;continue;} const key=url.toLowerCase(); if(seen.has(key)){duplicateCount++;continue;} seen.add(key); links.push(url); }
    const file=await db.query(`INSERT INTO link_import_files(file_name,file_size,total_links,valid_links,duplicate_links,invalid_links,status) VALUES($1,$2,$3,$4,$5,$6,'ready') RETURNING *`,[fileName||'links.txt',Buffer.byteLength(String(content||''),'utf8'),links.length+duplicateCount+invalidCount,links.length,duplicateCount,invalidCount]);
    for (const url of links) await db.query(`INSERT INTO link_import_items(file_id,url,status) VALUES($1,$2,'pending') ON CONFLICT(file_id,url) DO NOTHING`,[file.rows[0].id,url]);
    return { file:file.rows[0], preview:links.slice(0,100).map((url,i)=>({index:i+1,url,status:'pending'})) };
  }
  async listFiles(accountId){const db=await DatabaseManager.getAccountDB(accountId); return (await db.query('SELECT * FROM link_import_files ORDER BY created_at DESC LIMIT 100')).rows;}
  async getFile(accountId,fileId){const db=await DatabaseManager.getAccountDB(accountId); const [f,items]=await Promise.all([db.query('SELECT * FROM link_import_files WHERE id=$1',[fileId]),db.query('SELECT * FROM link_import_items WHERE file_id=$1 ORDER BY id LIMIT 500',[fileId])]); return {file:f.rows[0]||null,items:items.rows};}
  async start({accountId,fileId,accountIds,minDelay,maxDelay,maxAttempts=3}) {
    const selected=[...new Set(accountIds||[])].filter(id=>WhatsAppManager.isReady(id)); if(!selected.length)throw new Error('لا يوجد حساب متصل وجاهز للعمل');
    const db=await DatabaseManager.getAccountDB(accountId); const active=await db.query("SELECT id FROM link_import_jobs WHERE status IN ('queued','running','waiting','reconnecting','paused_system','paused') LIMIT 1"); if(active.rows.length)throw new Error('توجد عملية تشغيل نشطة لهذا الحساب');
    const rows=await db.query("SELECT id FROM link_import_items WHERE file_id=$1 AND status IN ('pending','retry','processing') ORDER BY id",[fileId]); if(!rows.rows.length)throw new Error('لا توجد روابط قابلة للمعالجة');
    const id=randomUUID(); const min=Math.max(0,Number(minDelay)||30); const max=Math.max(min,Number(maxDelay)||min); const retries=Math.min(10,Math.max(1,Number(maxAttempts)||3));
    await db.query(`INSERT INTO link_import_jobs(id,file_id,status,selected_account_ids,total,min_delay,max_delay,max_attempts,next_run_at,started_at,last_activity_at) VALUES($1,$2,'running',$3,$4,$5,$6,$7,NOW(),NOW(),NOW())`,[id,fileId,JSON.stringify(selected),rows.rows.length,min,max,retries]);
    await db.query('UPDATE link_import_items SET max_attempts=$2 WHERE file_id=$1',[fileId,retries]); for(const account of selected)await db.query('INSERT INTO link_import_account_state(job_id,account_id,status) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,account,'idle']);
    await db.query("UPDATE link_import_files SET status='running',operation_id=$2,started_at=NOW() WHERE id=$1",[fileId,id]);
    await this._event(db,id,'started',null,null,'بدأت المهمة');
    const job=this._rowToJob({id,file_id:fileId,status:'running',selected_account_ids:selected,total:rows.rows.length,processed:0,successful:0,failed:0,skipped:0,min_delay:min,max_delay:max,started_at:new Date().toISOString()}); jobs.set(id,job); return job;
  }
  _rowToJob(row){return {id:row.id,fileId:row.file_id,accountIds:Array.isArray(row.selected_account_ids)?row.selected_account_ids:JSON.parse(row.selected_account_ids||'[]'),status:row.status,total:Number(row.total||0),processed:Number(row.processed||0),successful:Number(row.successful||0),failed:Number(row.failed||0),skipped:Number(row.skipped||0),minDelay:Number(row.min_delay||30),maxDelay:Number(row.max_delay||30),maxAttempts:Number(row.max_attempts||3),startedAt:row.started_at,lastError:row.last_error||null,nextRunAt:row.next_run_at||null};}
  async _broadcast(db,jobId){ try { const [j,a,i,e]=await Promise.all([db.query('SELECT j.*,f.file_name FROM link_import_jobs j JOIN link_import_files f ON f.id=j.file_id WHERE j.id=$1',[jobId]),db.query('SELECT * FROM link_import_account_state WHERE job_id=$1 ORDER BY updated_at DESC',[jobId]),db.query("SELECT * FROM link_import_items WHERE file_id=(SELECT file_id FROM link_import_jobs WHERE id=$1) AND status IN ('processing','retry','joined','already_joined','pending_approval','invalid_link','failed') ORDER BY COALESCE(processed_at,started_at,updated_at) DESC NULLS LAST LIMIT 100",[jobId]),db.query('SELECT * FROM link_import_events WHERE job_id=$1 ORDER BY created_at DESC LIMIT 100',[jobId])]); const row=j.rows[0]; if(!row)return; SocketBridge.to(`link-import:${jobId}`).emit('link_import:update',{job:this._rowToJob(row),accounts:a.rows,items:i.rows,events:e.rows,serverTime:new Date().toISOString()}); } catch(error){ console.warn(`[LinkImportWorker] broadcast failed: ${error.message}`); } }
  async _event(db,jobId,type,accountId,itemId,message,details={}){await db.query('INSERT INTO link_import_events(job_id,account_id,item_id,event_type,message,details) VALUES($1,$2,$3,$4,$5,$6)',[jobId,accountId,itemId,type,message,JSON.stringify(details)]).catch(()=>{}); await this._broadcast(db,jobId);}
  async _tickAccount(accountId){
    const db=await DatabaseManager.getAccountDB(accountId);
    const jobsRows=await db.query("SELECT * FROM link_import_jobs WHERE status IN ('queued','running','waiting','reconnecting','paused_system') AND (next_run_at IS NULL OR next_run_at<=NOW()) ORDER BY created_at LIMIT 10");
    for(const row of jobsRows.rows){
      const selected=Array.isArray(row.selected_account_ids)?row.selected_account_ids:JSON.parse(row.selected_account_ids||'[]');
      if(!selected.length){ await db.query("UPDATE link_import_jobs SET status='failed',last_error=$2,updated_at=NOW() WHERE id=$1",[row.id,'لا توجد حسابات محددة']); continue; }
      const pending=await db.query("SELECT id,url,attempts,max_attempts FROM link_import_items WHERE file_id=$1 AND status IN ('pending','retry') ORDER BY id LIMIT 1",[row.file_id]);
      if(!pending.rows.length){
        const left=await db.query("SELECT 1 FROM link_import_items WHERE file_id=$1 AND status IN ('pending','retry','processing') LIMIT 1",[row.file_id]);
        if(!left.rows.length){ await db.query("UPDATE link_import_jobs SET status='completed',updated_at=NOW() WHERE id=$1",[row.id]); await db.query("UPDATE link_import_files SET status='completed',processed_links=valid_links,completed_at=NOW() WHERE id=$1",[row.file_id]); await this._event(db,row.id,'completed',null,null,'اكتملت المهمة'); }
        continue;
      }
      const item=pending.rows[0]; const accountIdForItem=selected[Number(row.processed||0)%selected.length];
      if(!WhatsAppManager.isReady(accountIdForItem)){ await db.query("UPDATE link_import_jobs SET status='reconnecting',next_run_at=NOW()+INTERVAL '5 seconds',last_error=$2,updated_at=NOW() WHERE id=$1",[row.id,'الحساب أو الاتصال غير جاهز']); await this._event(db,row.id,'reconnecting',accountIdForItem,item.id,'بانتظار عودة الاتصال'); continue; }
      await db.query("UPDATE link_import_jobs SET status='running',last_attempt_at=NOW(),last_activity_at=NOW(),updated_at=NOW() WHERE id=$1",[row.id]);
      await db.query("UPDATE link_import_items SET status='processing',attempts=attempts+1,assigned_account_id=$2,started_at=COALESCE(started_at,NOW()),last_error=NULL WHERE id=$1",[item.id,accountIdForItem]);
      await db.query("UPDATE link_import_account_state SET status='processing',current_item_id=$3,last_attempt_at=NOW(),updated_at=NOW() WHERE job_id=$1 AND account_id=$2",[row.id,accountIdForItem,item.id]); await this._event(db,row.id,'processing',accountIdForItem,item.id,'بدأت معالجة الرابط');
      let result; const inviteCode=GroupJoinerService._extractInviteCode(item.url); try{const prior=inviteCode?await db.query('SELECT group_id,status FROM link_import_join_history WHERE account_id=$1 AND invite_code=$2 AND status IN (\'joined\',\'already_joined\') LIMIT 1',[accountIdForItem,inviteCode]):{rows:[]}; if(prior.rows.length){result={success:true,status:'already_joined',confirmed:true,groupId:prior.rows[0].group_id||null,error:'تم الانضمام إلى المجموعة مسبقاً بهذا الحساب'};}else{result=await GroupJoinerService._doJoin(accountIdForItem,item.url);}}catch(error){result={success:false,status:'failed',retryable:false,error:error.message};} if(result?.success===true&&['joined','already_joined'].includes(result.status)&&inviteCode){await db.query(`INSERT INTO link_import_join_history(account_id,invite_code,normalized_url,group_id,status,last_seen_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(account_id,invite_code) DO UPDATE SET group_id=COALESCE(EXCLUDED.group_id,link_import_join_history.group_id),status=EXCLUDED.status,last_seen_at=NOW()`,[accountIdForItem,inviteCode,item.url,result.groupId||null,result.status]).catch(error=>console.warn(`[LinkImportWorker] join history write failed: ${error.message}`));}
      const attempts=Number(item.attempts||0)+1; const maxAttempts=Number(row.max_attempts||item.max_attempts||3); const isSuccess=result?.success===true && ['joined','already_joined'].includes(result?.status); const isApproval=result?.status==='pending_approval'; const isRetry=result?.retryable===true && attempts<maxAttempts;
      if(isRetry){ const delay=Math.min(3600,Math.max(5,Number(row.min_delay||30))*Math.pow(2,Math.max(0,attempts-1))); await db.query("UPDATE link_import_items SET status='retry',result=$2,last_error=$3,processed_at=NULL WHERE id=$1",[item.id,JSON.stringify(result),result.error||'خطأ مؤقت']); await db.query("UPDATE link_import_jobs SET status='waiting',next_run_at=NOW()+($2 * INTERVAL '1 second'),last_error=$3,updated_at=NOW() WHERE id=$1",[row.id,delay,result.error||'إعادة المحاولة']); await db.query("UPDATE link_import_account_state SET status='idle',current_item_id=NULL,last_error=$3,updated_at=NOW() WHERE job_id=$1 AND account_id=$2",[row.id,accountIdForItem,result.error||'إعادة المحاولة']); await this._event(db,row.id,'retry',accountIdForItem,item.id,`إعادة المحاولة ${attempts}/${maxAttempts}`,{result}); continue; }
      const finalStatus=isSuccess?(result.status==='already_joined'?'already_joined':'joined'):(isApproval?'pending_approval':result?.status==='invalid_link'?'invalid_link':'failed'); const errorMessage=result?.error||(!isSuccess?'فشل تنفيذ الرابط':null); const successful=isSuccess?1:0; const skipped=isApproval?1:0; const failed=(!isSuccess&&!isApproval)?1:0;
      await db.query("UPDATE link_import_items SET status=$2,result=$3,last_error=$4,processed_at=NOW(),finished_at=NOW() WHERE id=$1",[item.id,finalStatus,JSON.stringify(result||{}),errorMessage]); await db.query("UPDATE link_import_jobs SET status='waiting',processed=processed+1,successful=successful+$2,failed=failed+$3,skipped=skipped+$4,next_run_at=NOW()+($5 * INTERVAL '1 second'),last_activity_at=NOW(),updated_at=NOW(),last_error=$6 WHERE id=$1",[row.id,successful,failed,skipped,Number(row.min_delay)+(Number(row.max_delay)-Number(row.min_delay))*Math.random(),errorMessage]); await db.query("UPDATE link_import_account_state SET status='idle',current_item_id=NULL,processed=processed+1,successful=successful+$3,failed=failed+$4,skipped=skipped+$5,last_error=$6,updated_at=NOW() WHERE job_id=$1 AND account_id=$2",[row.id,accountIdForItem,successful,failed,skipped,errorMessage]); await db.query("UPDATE link_import_files SET processed_links=processed_links+1 WHERE id=$1",[row.file_id]); await this._event(db,row.id,finalStatus,accountIdForItem,item.id,errorMessage||'تم تأكيد النتيجة من واتساب',{result,attempts}); return;
    }
  }
  async startWorker(){if(this._workerTimer)return; const accounts=await getPool().query('SELECT id FROM accounts').catch(()=>({rows:[]})); for(const account of accounts.rows){const db=await DatabaseManager.getAccountDB(account.id);await db.query("UPDATE link_import_jobs SET status='reconnecting',next_run_at=NOW(),updated_at=NOW() WHERE status IN ('running','waiting','reconnecting','paused_system')").catch(()=>{});await db.query("UPDATE link_import_items SET status='pending',started_at=NULL WHERE status='processing' AND processed_at IS NULL").catch(()=>{});} this._workerTimer=setInterval(()=>this._runWorker().catch(error=>console.error('[LinkImportWorker]',error.message)),1000); await this._runWorker();}
  async _runWorker(){if(this._workerBusy)return;this._workerBusy=true;try{const accounts=await getPool().query('SELECT id FROM accounts').catch(()=>({rows:[]}));for(const account of accounts.rows)await this._tickAccount(account.id);}finally{this._workerBusy=false;}}
  stopWorker(){if(this._workerTimer){clearInterval(this._workerTimer);this._workerTimer=null;}}
  async getJobDetails(accountId,jobId){ const db=await DatabaseManager.getAccountDB(accountId); const r=await db.query('SELECT j.*,f.file_name FROM link_import_jobs j JOIN link_import_files f ON f.id=j.file_id WHERE j.id=$1',[jobId]); if(!r.rows[0])return null; await this._broadcast(db,jobId); const [a,i,e]=await Promise.all([db.query('SELECT * FROM link_import_account_state WHERE job_id=$1 ORDER BY updated_at DESC',[jobId]),db.query("SELECT * FROM link_import_items WHERE file_id=$1 ORDER BY id LIMIT 500",[r.rows[0].file_id]),db.query('SELECT * FROM link_import_events WHERE job_id=$1 ORDER BY created_at DESC LIMIT 100',[jobId])]); return {job:this._rowToJob(r.rows[0]),accounts:a.rows,items:i.rows,events:e.rows}; }
  async listJobs(accountId){const db=await DatabaseManager.getAccountDB(accountId);const r=await db.query("SELECT * FROM link_import_jobs WHERE status NOT IN ('completed','stopped') ORDER BY created_at DESC LIMIT 20");return r.rows.map(row=>this._rowToJob(row));}
  async getJob(accountId,jobId){if(jobs.has(jobId))return jobs.get(jobId);const db=await DatabaseManager.getAccountDB(accountId);const r=await db.query('SELECT j.* FROM link_import_jobs j JOIN link_import_files f ON f.id=j.file_id WHERE j.id=$1',[jobId]);if(!r.rows[0])return null;const job=this._rowToJob(r.rows[0]);jobs.set(jobId,job);return job;}
  async _control(accountId,jobId,status){const db=await DatabaseManager.getAccountDB(accountId);const r=await db.query('UPDATE link_import_jobs SET status=$2,next_run_at=NOW(),updated_at=NOW() WHERE id=$1 AND status NOT IN (\'completed\',\'stopped\') RETURNING *',[jobId,status]);if(!r.rows[0])throw new Error('العملية غير موجودة أو منتهية');const job=this._rowToJob(r.rows[0]);jobs.set(jobId,job);await this._event(db,jobId,status,null,null,status==='paused'?'تم إيقاف المهمة مؤقتاً':status==='stopped'?'تم إيقاف المهمة':'تم استئناف المهمة');return job;}
  async pause(accountId,jobId){return this._control(accountId,jobId,'paused');}
  async resume(accountId,jobId){return this._control(accountId,jobId,'running');}
  async stop(accountId,jobId){const job=await this._control(accountId,jobId,'stopped');const db=await DatabaseManager.getAccountDB(accountId);await db.query("UPDATE link_import_files SET status='stopped' WHERE operation_id=$1",[jobId]);return job;}
}
module.exports = new LinkImportService();
module.exports.normaliseUrl=normaliseUrl; module.exports.inviteCode=inviteCode; module.exports.extractInboundValues=extractInboundValues; module.exports.extractDocxText=extractDocxText;
