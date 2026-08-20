const assert = require('assert');
const WhatsAppManager = require('./src/bot/WhatsAppManager');
const GroupJoinerService = require('./src/api/services/GroupJoinerService');
const originalSession = WhatsAppManager.getSession;
const originalReady = WhatsAppManager.isReady;
(async () => {
  WhatsAppManager.getSession = () => null;
  WhatsAppManager.isReady = () => false;
  let result = await GroupJoinerService._doJoin('offline', 'https://chat.whatsapp.com/AbCdEf123456789012345678');
  assert.equal(result.status, 'account_offline');
  result = await GroupJoinerService._doJoin('offline', 'not-a-link');
  assert.equal(result.status, 'account_offline');
  WhatsAppManager.getSession = () => ({
    user: { id: '12345@s.whatsapp.net' },
    groupAcceptInvite: async () => '12345@g.us',
    groupMetadata: async () => ({ participants: [{ id: '12345@s.whatsapp.net' }] }),
  });
  WhatsAppManager.isReady = () => true;
  result = await GroupJoinerService._doJoin('ready', 'https://chat.whatsapp.com/AbCdEf123456789012345678');
  assert.equal(result.status, 'joined'); assert.equal(result.confirmed, true);
  WhatsAppManager.getSession = () => ({
    user: { id: '12345@s.whatsapp.net' },
    groupAcceptInvite: async () => { throw new Error('already a participant'); },
    groupGetInviteInfo: async () => ({ id: '12345@g.us' }),
    groupMetadata: async () => ({ participants: [{ id: '12345@s.whatsapp.net' }] }),
  });
  result = await GroupJoinerService._doJoin('ready', 'https://chat.whatsapp.com/AbCdEf123456789012345678');
  assert.equal(result.status, 'already_joined'); assert.equal(result.success, true);
  WhatsAppManager.getSession = originalSession; WhatsAppManager.isReady = originalReady;
  console.log('real-join-outcomes: ok');
})().catch(error => { WhatsAppManager.getSession = originalSession; WhatsAppManager.isReady = originalReady; throw error; });
