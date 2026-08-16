'use strict';
const GroupNumberService = require('../services/GroupNumberService');

class GroupNumberController {
  _user(req) { return req.user?.id || req.user?.userId; }
  async accounts(req,res) { try { res.json({ success:true, accounts:await GroupNumberService.getAccounts(this._user(req)) }); } catch(e) { res.status(500).json({success:false,error:e.message}); } }
  async start(req,res) { try { res.status(202).json({success:true, job:await GroupNumberService.createJob(this._user(req), req.body?.account_ids)}); } catch(e) { res.status(400).json({success:false,error:e.message}); } }
  async latest(req,res) { try { res.json({success:true, job:await GroupNumberService.getLatestJob(this._user(req))}); } catch(e) { res.status(500).json({success:false,error:e.message}); } }
  async jobs(req,res) { try { res.json({success:true,jobs:await GroupNumberService.listJobs(this._user(req),req.query.limit)}); } catch(e) { res.status(500).json({success:false,error:e.message}); } }
  async job(req,res) { try { const job=await GroupNumberService.getJob(this._user(req),req.params.id); if(!job)return res.status(404).json({success:false,error:'العملية غير موجودة'}); res.json({success:true,job}); } catch(e) { res.status(500).json({success:false,error:e.message}); } }
  async activity(req,res) { try { res.json({success:true,events:await GroupNumberService.getActivity(this._user(req),req.params.id,req.query.limit)}); } catch(e) { res.status(500).json({success:false,error:e.message}); } }
  async control(req,res) { try { res.json({success:true,job:await GroupNumberService.control(this._user(req),req.params.id,req.body?.action)}); } catch(e) { res.status(400).json({success:false,error:e.message}); } }
  async numbers(req,res) { try { res.json({success:true,...await GroupNumberService.listNumbers(this._user(req),req.query)}); } catch(e) { res.status(500).json({success:false,error:e.message}); } }
  async number(req,res) { try { const row=await GroupNumberService.getNumber(this._user(req),req.params.id); if(!row)return res.status(404).json({success:false,error:'الرقم غير موجود'}); res.json({success:true,number:row}); } catch(e) { res.status(500).json({success:false,error:e.message}); } }
  async deleteNumbers(req,res) { try { res.json({success:true,...await GroupNumberService.deleteNumbers(this._user(req),req.body?.ids)}); } catch(e) { res.status(400).json({success:false,error:e.message}); } }
  async organize(req,res) { try { res.json({success:true,...await GroupNumberService.organize(this._user(req))}); } catch(e) { res.status(500).json({success:false,error:e.message}); } }
  async stats(req,res) { try { res.json({success:true,stats:await GroupNumberService.stats(this._user(req))}); } catch(e) { res.status(500).json({success:false,error:e.message}); } }
  async countries(req,res) { res.json({success:true,countries:GroupNumberService.getCountryRules()}); }
  async exportCsv(req,res) {
    try {
      const data=await GroupNumberService.listNumbers(this._user(req),{...req.query,page:1,exportAll:true});
      const saudiOnly=req.query.saudi==='true'; const rows=saudiOnly ? data.rows.map(r=>r.normalized_phone) : data.rows.map(r=>[r.normalized_phone,r.country_name,r.is_saudi?'نعم':'لا',r.is_admin?'نعم':'لا',r.appearance_count].join(','));
      const csv='\ufeff'+rows.join('\n')+'\n'; res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename="Group_Numbers_${new Date().toISOString().slice(0,10)}.csv"`); res.send(csv);
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
  }
}
module.exports = new GroupNumberController();
