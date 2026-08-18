'use strict';
/**
 * DatabaseManager — Per-Account PostgreSQL Schema Manager
 * ─────────────────────────────────────────────────────────────────────
 * [DB-UNIFY] توحيد طبقة قاعدة البيانات:
 *  - DatabaseManager لم يعد يُنشئ pool مستقلًا من `pg` مباشرة.
 *  - إنشاء الـ schema لكل حساب + عميل الاتصال المخصّص (search_path) يتم
 *    عبر الـ pool المركزي الوحيد في `src/lib/postgres.js` (createAccountPool)،
 *    لضمان إعدادات اتصال موحّدة (ssl, keepAlive, reconnect, DB_POOL_MAX).
 */
const { getPool, createAccountPool } = require('../lib/postgres');
const SystemDB = require('./SystemDB');

const accountDBs = new Map();

const ACCOUNT_SCHEMA = (s) => `
CREATE SCHEMA IF NOT EXISTS "${s}";
SET search_path TO "${s}", public;

CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, description TEXT, participant_count INT DEFAULT 0, category TEXT DEFAULT 'general', is_active BOOLEAN DEFAULT TRUE, joined_at TIMESTAMPTZ DEFAULT NOW(), last_sync_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS group_members (group_id TEXT, phone TEXT NOT NULL, name TEXT, is_admin BOOLEAN DEFAULT FALSE, joined_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (group_id, phone));
CREATE TABLE IF NOT EXISTS links (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), url TEXT NOT NULL, group_id TEXT, source_message TEXT, category TEXT DEFAULT 'general', is_spam BOOLEAN DEFAULT FALSE, extracted_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS schedules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, status VARCHAR(50) DEFAULT 'active', cron_expr TEXT, ad_library_id UUID, target_groups JSONB DEFAULT '[]', next_run_at TIMESTAMPTZ, last_run_at TIMESTAMPTZ, run_count INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS ad_library (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, content TEXT DEFAULT '', media_paths JSONB DEFAULT '[]', media_types JSONB DEFAULT '[]', links JSONB DEFAULT '[]', format_options JSONB DEFAULT '{}', priority INT DEFAULT 5, tags TEXT DEFAULT '', is_active BOOLEAN DEFAULT TRUE, use_count INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE ad_library ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS campaigns (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, status VARCHAR(50) DEFAULT 'pending', target_groups JSONB DEFAULT '[]', ad_library_id UUID, sent_count INT DEFAULT 0, failed_count INT DEFAULT 0, total_targets INT DEFAULT 0, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS broadcast_schedules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, account_id TEXT, status VARCHAR(50) DEFAULT 'paused', target_group_jids JSONB DEFAULT '[]', ad_library_ids JSONB DEFAULT '[]', rotation_mode VARCHAR(50) DEFAULT 'sequential', active_days JSONB DEFAULT '[0,1,2,3,4,5,6]', publish_times JSONB DEFAULT '[]', max_per_day INT DEFAULT 3, send_to_members BOOLEAN DEFAULT FALSE, exclude_admins BOOLEAN DEFAULT TRUE, next_run_at TIMESTAMPTZ, last_run_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE broadcast_schedules ADD COLUMN IF NOT EXISTS account_id TEXT;
ALTER TABLE broadcast_schedules ADD COLUMN IF NOT EXISTS target_group_jids JSONB DEFAULT '[]';
ALTER TABLE broadcast_schedules ADD COLUMN IF NOT EXISTS ad_library_ids JSONB DEFAULT '[]';
ALTER TABLE broadcast_schedules ADD COLUMN IF NOT EXISTS rotation_mode VARCHAR(50) DEFAULT 'sequential';
ALTER TABLE broadcast_schedules ADD COLUMN IF NOT EXISTS active_days JSONB DEFAULT '[0,1,2,3,4,5,6]';
ALTER TABLE broadcast_schedules ADD COLUMN IF NOT EXISTS publish_times JSONB DEFAULT '[]';
ALTER TABLE broadcast_schedules ADD COLUMN IF NOT EXISTS max_per_day INT DEFAULT 3;
ALTER TABLE broadcast_schedules ADD COLUMN IF NOT EXISTS send_to_members BOOLEAN DEFAULT FALSE;
ALTER TABLE broadcast_schedules ADD COLUMN IF NOT EXISTS exclude_admins BOOLEAN DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS direct_publish_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id TEXT, ad_library_id UUID, target_group_jids JSONB DEFAULT '[]', custom_content TEXT DEFAULT '', status VARCHAR(50) DEFAULT 'sent', send_to_members BOOLEAN DEFAULT FALSE, exclude_admins BOOLEAN DEFAULT TRUE, members_sent INT DEFAULT 0, sent_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS account_id TEXT;
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS target_group_jids JSONB DEFAULT '[]';
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS custom_content TEXT DEFAULT '';
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'sent';
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS send_to_members BOOLEAN DEFAULT FALSE;
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS exclude_admins BOOLEAN DEFAULT TRUE;
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS members_sent INT DEFAULT 0;
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS ad_library_ids JSONB DEFAULT '[]';
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS groups_targeted INT DEFAULT 0;
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS groups_sent INT DEFAULT 0;
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS groups_failed INT DEFAULT 0;
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS members_targeted INT DEFAULT 0;
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS members_failed INT DEFAULT 0;
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS member_delay_ms INT DEFAULT 1500;
ALTER TABLE direct_publish_log ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '[]';
CREATE TABLE IF NOT EXISTS group_exclusions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), phone TEXT NOT NULL UNIQUE, reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS join_queue (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), link_url TEXT NOT NULL, status VARCHAR(50) DEFAULT 'pending', attempts INT DEFAULT 0, last_attempt_at TIMESTAMPTZ, joined_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS link_search_settings (id INT PRIMARY KEY DEFAULT 1, settings JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS link_join_settings (id INT PRIMARY KEY DEFAULT 1, settings JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS sync_settings (id INT PRIMARY KEY DEFAULT 1, settings JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS account_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), level VARCHAR(20) DEFAULT 'info', message TEXT, details JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS connection_attempts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status VARCHAR(50), method VARCHAR(50), duration_ms INT, error_message TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS qr_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id UUID, event_type VARCHAR(50), latency_ms INT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS baileys_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_type VARCHAR(100), success BOOLEAN DEFAULT TRUE, error_message TEXT, details JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS diagnostics (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), report JSONB, score INT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS business_api_settings (id INT PRIMARY KEY DEFAULT 1, phone_number_id TEXT, access_token TEXT, webhook_verify_token TEXT, settings JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS pairing_attempts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), phone TEXT, code TEXT, status VARCHAR(50), latency_ms INT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, name TEXT, applied_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS link_import_settings (id INT PRIMARY KEY DEFAULT 1, settings JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS link_import_files (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), file_name TEXT NOT NULL, file_size BIGINT DEFAULT 0, total_links INT DEFAULT 0, valid_links INT DEFAULT 0, duplicate_links INT DEFAULT 0, invalid_links INT DEFAULT 0, processed_links INT DEFAULT 0, status VARCHAR(30) DEFAULT 'ready', operation_id UUID, import_policy VARCHAR(30) DEFAULT 'ignore_duplicates', source_type VARCHAR(20) DEFAULT 'file', error_message TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE link_import_files ADD COLUMN IF NOT EXISTS import_policy VARCHAR(30) DEFAULT 'ignore_duplicates';
ALTER TABLE link_import_files ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'file';
ALTER TABLE link_import_files ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE link_import_files ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE link_import_files ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE link_import_files ADD COLUMN IF NOT EXISTS processed_links INT DEFAULT 0;
ALTER TABLE link_import_files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE TABLE IF NOT EXISTS link_import_items (id BIGSERIAL PRIMARY KEY, file_id UUID NOT NULL REFERENCES link_import_files(id) ON DELETE CASCADE, url TEXT NOT NULL, original_url TEXT, normalized_url TEXT, url_hash TEXT, duplicate_reason VARCHAR(40), validation_status VARCHAR(30) DEFAULT 'valid', status VARCHAR(30) DEFAULT 'pending', assigned_account_id UUID, result JSONB, started_at TIMESTAMPTZ, processed_at TIMESTAMPTZ, UNIQUE(file_id,url));
ALTER TABLE link_import_items ADD COLUMN IF NOT EXISTS original_url TEXT;
ALTER TABLE link_import_items ADD COLUMN IF NOT EXISTS normalized_url TEXT;
ALTER TABLE link_import_items ADD COLUMN IF NOT EXISTS url_hash TEXT;
ALTER TABLE link_import_items ADD COLUMN IF NOT EXISTS duplicate_reason VARCHAR(40);
ALTER TABLE link_import_items ADD COLUMN IF NOT EXISTS validation_status VARCHAR(30) DEFAULT 'valid';
ALTER TABLE link_import_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_link_import_items_normalized_hash ON link_import_items(file_id,url_hash);
ALTER TABLE link_import_items ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0;
ALTER TABLE link_import_items ADD COLUMN IF NOT EXISTS max_attempts INT DEFAULT 3;
ALTER TABLE link_import_items ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE link_import_items ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_link_import_items_file_status ON link_import_items(file_id,status);
CREATE TABLE IF NOT EXISTS link_import_jobs (id UUID PRIMARY KEY, file_id UUID NOT NULL REFERENCES link_import_files(id) ON DELETE CASCADE, status VARCHAR(30) DEFAULT 'queued', selected_account_ids JSONB NOT NULL DEFAULT '[]', total INT DEFAULT 0, processed INT DEFAULT 0, successful INT DEFAULT 0, failed INT DEFAULT 0, skipped INT DEFAULT 0, min_delay INT DEFAULT 30, max_delay INT DEFAULT 60, max_attempts INT DEFAULT 3, distribution_mode VARCHAR(30) DEFAULT 'round_robin', retry_count INT DEFAULT 0, next_run_at TIMESTAMPTZ, started_at TIMESTAMPTZ, paused_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, last_activity_at TIMESTAMPTZ, last_attempt_at TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE link_import_jobs ADD COLUMN IF NOT EXISTS max_attempts INT DEFAULT 3;
ALTER TABLE link_import_jobs ADD COLUMN IF NOT EXISTS distribution_mode VARCHAR(30) DEFAULT 'round_robin';
ALTER TABLE link_import_jobs ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(40) DEFAULT 'full_file_per_account';
CREATE TABLE IF NOT EXISTS link_import_item_runs (job_id UUID NOT NULL REFERENCES link_import_jobs(id) ON DELETE CASCADE, account_id UUID NOT NULL, item_id BIGINT NOT NULL REFERENCES link_import_items(id) ON DELETE CASCADE, status VARCHAR(30) DEFAULT 'pending', attempts INT DEFAULT 0, max_attempts INT DEFAULT 3, result JSONB, last_error TEXT, started_at TIMESTAMPTZ, processed_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY(job_id, account_id, item_id));
CREATE INDEX IF NOT EXISTS idx_link_import_item_runs_account ON link_import_item_runs(job_id, account_id, status);
ALTER TABLE link_import_jobs ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;
ALTER TABLE link_import_jobs ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE link_import_jobs ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_link_import_jobs_status ON link_import_jobs(status);
CREATE TABLE IF NOT EXISTS link_import_account_state (job_id UUID NOT NULL REFERENCES link_import_jobs(id) ON DELETE CASCADE, account_id UUID NOT NULL, status VARCHAR(30) DEFAULT 'idle', current_item_id BIGINT, processed INT DEFAULT 0, successful INT DEFAULT 0, failed INT DEFAULT 0, skipped INT DEFAULT 0, last_attempt_at TIMESTAMPTZ, last_error TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY(job_id,account_id));
CREATE TABLE IF NOT EXISTS link_import_events (id BIGSERIAL PRIMARY KEY, job_id UUID NOT NULL REFERENCES link_import_jobs(id) ON DELETE CASCADE, account_id UUID, item_id BIGINT, event_type VARCHAR(40) NOT NULL, message TEXT, details JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS link_import_join_history (id BIGSERIAL PRIMARY KEY, account_id UUID NOT NULL, invite_code TEXT NOT NULL, normalized_url TEXT NOT NULL, group_id TEXT, status VARCHAR(30) NOT NULL DEFAULT 'joined', first_joined_at TIMESTAMPTZ DEFAULT NOW(), last_seen_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(account_id,invite_code));
CREATE INDEX IF NOT EXISTS idx_link_import_join_history_account ON link_import_join_history(account_id,status);
`;

const DatabaseManager = {
    systemDB: SystemDB,

    async init() {
        await SystemDB.init();
        console.log('[DatabaseManager] Initialized.');
    },

    async getAccountDB(accountId) {
        if (accountDBs.has(accountId)) return accountDBs.get(accountId);

        const schemaName = `acc_${accountId.replace(/-/g, '_')}`;

        // [DB-UNIFY] تطبيق الـ schema عبر عميل من الـ pool المركزي
        const client = await getPool().connect();
        try {
            // تشغيل كل statement منفصلاً لضمان تطبيق ALTER TABLE
            const schemaSQL = ACCOUNT_SCHEMA(schemaName);
            const statements = schemaSQL
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            for (const stmt of statements) {
                try {
                    await client.query(stmt);
                } catch (stmtErr) {
                    if (!stmtErr.message.includes('already exists')) {
                        console.warn(`[DatabaseManager] stmt warning (${accountId}):`, stmtErr.message);
                    }
                }
            }
        } catch (err) {
            console.error(`[DatabaseManager] Schema error for ${accountId}:`, err.message);
        } finally {
            client.release();
        }

        // [DB-UNIFY] عميل اتصال مخصّص بـ search_path من الـ pool المركزي
        const db = createAccountPool(accountId, schemaName);
        accountDBs.set(accountId, db);
        return db;
    },

    async closeAll() {
        accountDBs.clear();
        // [DB-UNIFY] إغلاق الـ pool المركزي الوحيد
        await SystemDB.close();
    },
};

module.exports = DatabaseManager;
