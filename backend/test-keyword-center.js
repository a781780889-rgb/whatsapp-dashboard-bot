'use strict';
const assert = require('assert');
const service = require('./src/api/services/KeywordMonitoringService');
assert.equal(service.normalizeText('  سَعْر   الخدمة  '), 'سعر الخدمة');
assert.equal(service.normalizeText('Hello   WORLD'), 'hello world');
assert.equal(service.extractMessageText({ message: { extendedTextMessage: { text: 'كم السعر؟' } } }), 'كم السعر؟');
assert.equal(service.extractMessageText({ message: { imageMessage: { caption: 'عرض' } } }), 'عرض');
console.log('keyword-center helpers: ok');
