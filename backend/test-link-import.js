const assert = require('assert');
const { normaliseUrl, inviteCode, extractInboundValues } = require('./src/api/services/LinkImportService');
assert.equal(normaliseUrl('  https://chat.whatsapp.com/AbCdEf1234567890  '), 'https://chat.whatsapp.com/AbCdEf1234567890');
assert.equal(inviteCode('https://chat.whatsapp.com/AbCdEf1234567890'), 'AbCdEf1234567890');
assert.equal(inviteCode('https://example.com/group'), null);
assert.equal(normaliseUrl('not a url'), null);
assert.deepEqual(extractInboundValues('name,https://chat.whatsapp.com/AbCdEf1234567890\nother,https://chat.whatsapp.com/ZyXwVu1234567890', 'inbound.csv'), ['name', 'https://chat.whatsapp.com/AbCdEf1234567890', 'other', 'https://chat.whatsapp.com/ZyXwVu1234567890']);
assert.deepEqual(extractInboundValues(JSON.stringify({ links: ['https://chat.whatsapp.com/AbCdEf1234567890'] }), 'inbound.json'), ['https://chat.whatsapp.com/AbCdEf1234567890']);
console.log('link-import helpers: ok');
