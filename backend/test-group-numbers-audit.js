'use strict';
const assert = require('assert');
const service = require('./src/api/services/GroupNumberService');
const db = require('./src/database/SystemDB');

(async () => {
  let sourceWritten = false; let memberInsertions = 0; let sourceWrites = 0;
  const oldGet = db.get; const oldRun = db.run;
  db.get = async (sql) => {
    if (sql.includes('SELECT s.id')) return sourceWritten ? { id: 'source-1' } : null;
    if (sql.includes('INSERT INTO group_numbers')) { memberInsertions += 1; return { id: 'number-1', appearance_count: 1 }; }
    return null;
  };
  db.run = async (sql) => { if (sql.includes('INSERT INTO group_number_sources')) { sourceWritten = true; sourceWrites += 1; } return { rowCount: 1 }; };
  try {
    const job = { user_id: 'user-1' }; const group = { id: 'group-1', subject: 'اختبار' };
    const first = await service._saveMember(job, 'account-1', group, { phone: '00966 50 123 4567', is_admin: false });
    const second = await service._saveMember(job, 'account-1', group, { phone: '+966501234567', is_admin: false });
    assert.equal(first.new, true); assert.equal(second.alreadyProcessed, true);
    assert.equal(memberInsertions, 1); assert.equal(sourceWrites, 1);
    assert.equal(service.classify('+966501234567').is_saudi, true);
    console.log('group-number idempotency audit test: ok');
  } finally { db.get = oldGet; db.run = oldRun; }
})().catch(err => { console.error(err); process.exit(1); });
