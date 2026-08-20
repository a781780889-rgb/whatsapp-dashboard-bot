'use strict';

const { query } = require('../lib/postgres');

const LinkImportMigrations = {
  async run() {
    await query(`
      CREATE TABLE IF NOT EXISTS link_import_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        filename TEXT NOT NULL,
        file_size_bytes INT NOT NULL,
        total_found INT NOT NULL DEFAULT 0,
        new_count INT NOT NULL DEFAULT 0,
        duplicate_count INT NOT NULL DEFAULT 0,
        invalid_count INT NOT NULL DEFAULT 0,
        review_count INT NOT NULL DEFAULT 0,
        processing_ms INT,
        status VARCHAR(20) NOT NULL DEFAULT 'completed',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS link_import_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        source_id UUID REFERENCES link_import_sources(id) ON DELETE SET NULL,
        url TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        invite_code TEXT NOT NULL,
        validation_status VARCHAR(20) NOT NULL DEFAULT 'valid',
        last_status VARCHAR(30),
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, canonical_url)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS link_import_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        min_delay_seconds INT NOT NULL DEFAULT 60,
        max_delay_seconds INT NOT NULL DEFAULT 180,
        max_retries INT NOT NULL DEFAULT 2,
        total_operations INT NOT NULL DEFAULT 0,
        completed_operations INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS link_import_operations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES link_import_tasks(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        account_id UUID NOT NULL,
        link_id UUID NOT NULL REFERENCES link_import_links(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempt_count INT NOT NULL DEFAULT 0,
        last_error TEXT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        next_retry_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(task_id, account_id, link_id)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS link_import_events (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        task_id UUID REFERENCES link_import_tasks(id) ON DELETE CASCADE,
        operation_id UUID REFERENCES link_import_operations(id) ON DELETE CASCADE,
        account_id UUID,
        link_id UUID,
        event_type VARCHAR(40) NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_link_import_sources_user ON link_import_sources(user_id, created_at DESC)`).catch(() => {});
    await query(`CREATE INDEX IF NOT EXISTS idx_link_import_links_user ON link_import_links(user_id, created_at DESC)`).catch(() => {});
    await query(`CREATE INDEX IF NOT EXISTS idx_link_import_ops_ready ON link_import_operations(status, next_retry_at, created_at)`).catch(() => {});
    await query(`CREATE INDEX IF NOT EXISTS idx_link_import_ops_task ON link_import_operations(task_id, status)`).catch(() => {});
    await query(`CREATE INDEX IF NOT EXISTS idx_link_import_events_user ON link_import_events(user_id, created_at DESC)`).catch(() => {});
    console.log('[LinkImportMigrations] Tables ready');
  },
};

module.exports = LinkImportMigrations;
