'use strict';
const AutoSearchService = require('../services/AutoSearchService');
const SystemDB = require('../../database/SystemDB');
const WhatsAppManager = require('../../bot/WhatsAppManager');
class AutoSearchController {
  async dashboard(req,res){try{res.json({success:true,...await AutoSearchService.getDashboard(req.query.accountId)})}catch(e){res.status(500).json({success:false,error:e.message})}}
  async accounts(req,res){try{const rows=await SystemDB.all('SELECT id,name,phone_number,status,health_status,last_activity_at FROM accounts ORDER BY created_at DESC');res.json({success:true,accounts:rows.map(a=>({...a,connected:WhatsAppManager.isReady(a.id)}))})}catch(e){res.status(500).json({success:false,error:e.message})}}
  async start(req,res){try{res.json({success:true,job:await AutoSearchService.start(req.body.accountId,req.body.accountIds,req.body.settings)})}catch(e){res.status(400).json({success:false,error:e.message})}}
  async control(req,res){try{res.json({success:true,...await AutoSearchService.control(req.body.accountId,req.params.action)})}catch(e){res.status(400).json({success:false,error:e.message})}}
  async scanNow(req,res){try{res.json({success:true,...await AutoSearchService.scanNow(req.body.accountId)})}catch(e){res.status(400).json({success:false,error:e.message})}}
  async settings(req,res){try{const data=await AutoSearchService.saveSettings(req.body.accountId,req.body.settings);res.json({success:true,settings:data})}catch(e){res.status(400).json({success:false,error:e.message})}}
  async links(req,res){try{res.json({success:true,...await AutoSearchService.listLinks(req.query.accountId,req.query)})}catch(e){res.status(500).json({success:false,error:e.message})}}
  async health(req,res){try{res.json({success:true,...await AutoSearchService.health(req.query.accountId)})}catch(e){res.status(500).json({success:false,error:e.message})}}
  async export(req,res){try{const rows=await AutoSearchService.exportLinks(req.query.accountId,req.query);const format=String(req.query.format||'json').toLowerCase();if(format==='csv'){const header='url,originalUrl,status,type,source,accountId,discoveredAt';const csv=[header,...rows.map(x=>[x.url,x.originalUrl,x.status,x.type,x.source,x.accountId,x.discoveredAt].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(','))].join('\n');return res.type('text/csv').send(csv)}if(format==='txt')return res.type('text/plain').send(rows.map(x=>x.url).join('\n'));res.json({success:true,format,links:rows})}catch(e){res.status(500).json({success:false,error:e.message})}}
  async copy(req,res){try{res.json({success:true,...await AutoSearchService.copyLinks(req.body.accountId,req.body.ids||[],req.body.filter||'new',req.user?.id||null)})}catch(e){res.status(400).json({success:false,error:e.message})}}
}
module.exports = new AutoSearchController();
