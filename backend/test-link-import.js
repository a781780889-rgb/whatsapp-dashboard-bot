const assert = require('assert');
const { normaliseUrl, inviteCode } = require('./src/api/services/LinkImportService');
assert.equal(normaliseUrl('  https://chat.whatsapp.com/AbCdEf1234567890  '), 'https://chat.whatsapp.com/AbCdEf1234567890');
assert.equal(inviteCode('https://chat.whatsapp.com/AbCdEf1234567890'), 'AbCdEf1234567890');
assert.equal(inviteCode('https://example.com/group'), null);
assert.equal(normaliseUrl('not a url'), null);
console.log('link-import helpers: ok');
