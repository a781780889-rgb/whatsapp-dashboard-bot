const LinkImportService = require('../services/LinkImportService');
const { getPool } = require('../../lib/postgres');

class LinkImportController {
  async import(req, res) {
    try { const result = await LinkImportService.importFile({ accountId: req.body.accountId, fileName: req.body.fileName, content: req.body.content }); res.json({ success: true, ...result }); }
    catch (e) { res.status(400).json({ success: false, error: e.message }); }
  }
  async files(req, res) { try { res.json({ success: true, files: await LinkImportService.listFiles(req.query.accountId) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } }
  async file(req, res) { try { res.json({ success: true, ...(await LinkImportService.getFile(req.query.accountId, req.params.fileId)) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } }
  async accounts(req, res) { try { const r = await getPool().query('SELECT id,name,phone_number,status,health_status,connection_type,last_activity_at FROM accounts ORDER BY created_at DESC'); res.json({ success: true, accounts: r.rows.map(a => ({ ...a, connected: require('../../bot/WhatsAppManager').isReady(a.id) })) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } }
  async start(req, res) { try { res.json({ success: true, job: await LinkImportService.start(req.body) }); } catch (e) { res.status(400).json({ success: false, error: e.message }); } }
  async jobs(req, res) { try { res.json({ success: true, jobs: await LinkImportService.listJobs(req.query.accountId) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } }
  async job(req, res) { try { const job = await LinkImportService.getJob(req.query.accountId, req.params.jobId); res.json({ success: !!job, job: job || null }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } }
  async control(req, res) { try { const fn = { pause: 'pause', resume: 'resume', stop: 'stop' }[req.params.action]; if (!fn) throw new Error('إجراء غير صالح'); res.json({ success: true, job: await LinkImportService[fn](req.body.accountId, req.params.jobId) }); } catch (e) { res.status(400).json({ success: false, error: e.message }); } }
}
module.exports = new LinkImportController();
