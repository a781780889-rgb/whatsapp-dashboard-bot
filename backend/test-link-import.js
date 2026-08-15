const assert = require('assert');
const { normaliseUrl, inviteCode, extractInboundValues } = require('./src/api/services/LinkImportService');
assert.equal(normaliseUrl('  https://chat.whatsapp.com/AbCdEf123456789012345678  '), 'https://chat.whatsapp.com/AbCdEf123456789012345678');
assert.equal(inviteCode('https://chat.whatsapp.com/AbCdEf123456789012345678'), 'AbCdEf123456789012345678');
assert.equal(inviteCode('https://example.com/group'), null);
assert.equal(normaliseUrl('not a url'), null);
assert.deepEqual(extractInboundValues('name,https://chat.whatsapp.com/AbCdEf123456789012345678\nother,https://chat.whatsapp.com/ZyXwVu123456789012345678', 'inbound.csv'), ['name', 'https://chat.whatsapp.com/AbCdEf123456789012345678', 'other', 'https://chat.whatsapp.com/ZyXwVu123456789012345678']);
assert.deepEqual(extractInboundValues(JSON.stringify({ links: ['https://chat.whatsapp.com/AbCdEf123456789012345678'] }), 'inbound.json'), ['https://chat.whatsapp.com/AbCdEf123456789012345678']);
console.log('link-import helpers: ok');
