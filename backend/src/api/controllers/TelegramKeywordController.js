'use strict';
const Service = require('../services/TelegramKeywordService');
const TelegramService = require('../services/TelegramService');
const { queryOne } = require('../../lib/postgres');
const Controller = {
  async dashboard(req,res){ try { return res.json({success:true,...await Service.dashboard(req.user.id,req.query)}); } catch(e){ return res.status(500).json({success:false,error:'تعذر تحميل مركز كلمات تيليجرام'}); } },
  async accounts(req,res){ try { return res.json({success:true,accounts:await Service.accounts(req.user.id)}); } catch(e){ return res.status(500).json({success:false,error:'تعذر تحميل الحسابات'}); } },
  async create(req,res){ try { return res.status(201).json({success:true,keyword:await Service.createKeyword(req.user.id,req.body)}); } catch(e){ return res.status(400).json({success:false,error:e.message}); } },
  async update(req,res){ try { return res.json({success:true,keyword:await Service.updateKeyword(req.user.id,req.params.id,req.body)}); } catch(e){ return res.status(400).json({success:false,error:e.message}); } },
  async remove(req,res){ try { await Service.deleteKeyword(req.user.id,req.params.id); return res.json({success:true}); } catch(e){ return res.status(404).json({success:false,error:e.message}); } },
  async openDirectChat(req,res){ try { return res.json({success:true,...await Service.openDirectChat(req.user.id,req.params.id)}); } catch(e){ return res.status(e.code === 'ACCOUNT_OFFLINE' ? 409 : 400).json({success:false,error:e.message,code:e.code || 'TELEGRAM_CHAT_OPEN_FAILED'}); } },
  async reply(req,res){ try { return res.json({success:true,...await Service.reply(req.user.id,req.params.id,req.body.text)}); } catch(e){ return res.status(e.code === 'ACCOUNT_OFFLINE' ? 409 : 400).json({success:false,error:e.message,code:e.code || 'TELEGRAM_REPLY_FAILED'}); } },
  async worker(req,res){ try { const accounts=await Service.accounts(req.user.id); return res.json({success:true,workers:accounts.map(a=>({accountId:a.id,status:a.status,worker:TelegramService.getWorker(a.id)?.status||'stopped',lastCheck:TelegramService.getWorker(a.id)?.lastCheck||null,error:TelegramService.getWorker(a.id)?.error||null}))}); } catch(e){ return res.status(500).json({success:false,error:'تعذر تحميل حالة العمال'}); } },
};
module.exports = Controller;
