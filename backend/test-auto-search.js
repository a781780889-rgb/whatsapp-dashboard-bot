const assert = require('assert');
const { extractLinks, normalizeUrl } = require('./src/api/services/AutoSearchService');
const links = extractLinks('رابط https://chat.whatsapp.com/ABC_DEF_1234567890 https://chat.whatsapp.com/ABC_DEF_1234567890 https://t.me/+channel_123456789', { linkTypes:['whatsapp_group','telegram_group'], removeSpaces:true, normalize:true, validate:true });
assert.equal(links.length, 2);
assert.equal(normalizeUrl(' http://chat.whatsapp.com/ABC_DEF_1234567890 '), 'https://chat.whatsapp.com/ABC_DEF_1234567890');
assert.equal(extractLinks('https://example.com/not-an-invite').length, 0);
console.log('auto-search helpers: ok');
