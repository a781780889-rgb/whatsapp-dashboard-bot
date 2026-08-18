'use strict';
/**
 * Telegram System Migrations
 * إنشاء/تحديث جداول نظام تيليجرام في قاعدة البيانات
 */

const { query } = require('../lib/postgres');

const TelegramMigrations = {
    async run() {
        try {
            // ── جدول حسابات تيليجرام ─────────────────────────────────────
            await query(`
                CREATE TABLE IF NOT EXISTS telegram_accounts (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID,
                    name VARCHAR(200) NOT NULL,
                    phone_number VARCHAR(50),
                    api_id VARCHAR(100),
                    api_hash VARCHAR(200),
                    session_string TEXT,
                    bot_token TEXT,
                    bot_username VARCHAR(100),
                    status VARCHAR(50) DEFAULT 'disconnected',
                    last_activity_at TIMESTAMPTZ,
                    links_collected INT DEFAULT 0,
                    channels_monitored INT DEFAULT 0,
                    notes TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);

            // ── أعمدة المصادقة الحديثة ─────────────────────────────────
            const alterCmds = [
                `ALTER TABLE telegram_accounts ADD COLUMN IF NOT EXISTS session_encrypted TEXT`,
                `ALTER TABLE telegram_accounts ADD COLUMN IF NOT EXISTS telegram_user_id TEXT`,
                `ALTER TABLE telegram_accounts ADD COLUMN IF NOT EXISTS username VARCHAR(200)`,
                `ALTER TABLE telegram_accounts ADD COLUMN IF NOT EXISTS first_name VARCHAR(200)`,
                `ALTER TABLE telegram_accounts ADD COLUMN IF NOT EXISTS last_name VARCHAR(200)`,
                `ALTER TABLE telegram_accounts ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ`,
                `ALTER TABLE telegram_accounts ADD COLUMN IF NOT EXISTS auth_required BOOLEAN NOT NULL DEFAULT false`,
                `ALTER TABLE telegram_auth_sessions ADD COLUMN IF NOT EXISTS last_error TEXT`,
                `ALTER TABLE telegram_accounts ADD COLUMN IF NOT EXISTS bot_token TEXT`,
                `ALTER TABLE telegram_accounts ADD COLUMN IF NOT EXISTS bot_username VARCHAR(100)`,
                `ALTER TABLE telegram_keyword_results ADD COLUMN IF NOT EXISTS sender_access_hash TEXT`,
                `ALTER TABLE telegram_keyword_results ADD COLUMN IF NOT EXISTS sender_first_name TEXT`,
                `ALTER TABLE telegram_keyword_results ADD COLUMN IF NOT EXISTS sender_last_name TEXT`,
                `ALTER TABLE telegram_keyword_results ADD COLUMN IF NOT EXISTS sender_peer_type VARCHAR(30)`,
                `ALTER TABLE telegram_accounts ALTER COLUMN phone_number DROP NOT NULL`,
            ];
            for (const cmd of alterCmds) {
                await query(cmd).catch(() => {}); // تجاهل أخطاء "already exists"
            }
            await query(`
                CREATE TABLE IF NOT EXISTS telegram_auth_sessions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
                    phone_reference TEXT NOT NULL, phone_code_hash TEXT,
                    state VARCHAR(32) NOT NULL DEFAULT 'created', client_reference TEXT,
                    expires_at TIMESTAMPTZ NOT NULL, attempts INT NOT NULL DEFAULT 0, last_error TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_auth_active_phone ON telegram_auth_sessions(user_id,phone_reference) WHERE state IN ('created','code_requested','waiting_code','verifying','waiting_2fa')`).catch(() => {});
            await query(`CREATE INDEX IF NOT EXISTS idx_tg_auth_expiry ON telegram_auth_sessions(expires_at)`).catch(() => {});

            // ── جدول روابط واتساب المكتشفة ──────────────────────────────
            await query(`
                CREATE TABLE IF NOT EXISTS whatsapp_links (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    whatsapp_link TEXT NOT NULL UNIQUE,
                    source_account_id UUID,
                    source_account_name VARCHAR(200),
                    source_group VARCHAR(500),
                    source_channel VARCHAR(500),
                    discovered_at TIMESTAMPTZ DEFAULT NOW(),
                    last_seen TIMESTAMPTZ DEFAULT NOW(),
                    duplicate_count INT DEFAULT 0,
                    status VARCHAR(50) DEFAULT 'new',
                    joined BOOLEAN DEFAULT false,
                    copied BOOLEAN DEFAULT false,
                    deleted BOOLEAN DEFAULT false,
                    notes TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);

            await query(`ALTER TABLE whatsapp_links ADD COLUMN IF NOT EXISTS copied_at TIMESTAMPTZ`).catch(() => {});
            await query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_links_copied ON whatsapp_links(copied, discovered_at DESC) WHERE deleted=false`).catch(() => {});

            // ── الرسائل المتجاهلة في مركز كلمات تيليجرام ────────────────
            await query(`
                CREATE TABLE IF NOT EXISTS telegram_ignored_messages (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    telegram_account_id UUID NOT NULL,
                    chat_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    sender_id TEXT,
                    message_hash TEXT,
                    ignored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    ignored_by UUID,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (telegram_account_id, chat_id, message_id)
                )
            `);
            await query(`CREATE INDEX IF NOT EXISTS idx_tg_ignored_lookup ON telegram_ignored_messages(telegram_account_id, chat_id, message_id)`).catch(() => {});
            await query(`CREATE INDEX IF NOT EXISTS idx_tg_ignored_hash ON telegram_ignored_messages(message_hash) WHERE message_hash IS NOT NULL`).catch(() => {});

            // ── مركز كلمات تيليجرام ─────────────────────────────────────
            await query(`
                CREATE TABLE IF NOT EXISTS telegram_keywords (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
                    keyword TEXT NOT NULL, match_mode VARCHAR(30) NOT NULL DEFAULT 'contains',
                    case_sensitive BOOLEAN NOT NULL DEFAULT false, normalize_arabic BOOLEAN NOT NULL DEFAULT true,
                    search_groups BOOLEAN NOT NULL DEFAULT true, search_channels BOOLEAN NOT NULL DEFAULT true,
                    account_ids JSONB NOT NULL DEFAULT '[]', is_active BOOLEAN NOT NULL DEFAULT true,
                    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            await query(`
                CREATE TABLE IF NOT EXISTS telegram_keyword_results (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
                    keyword_id UUID NOT NULL REFERENCES telegram_keywords(id) ON DELETE CASCADE,
                    telegram_account_id UUID NOT NULL REFERENCES telegram_accounts(id) ON DELETE CASCADE,
                    chat_id TEXT NOT NULL, message_id TEXT NOT NULL, sender_id TEXT,
                    sender_access_hash TEXT, sender_first_name TEXT, sender_last_name TEXT, sender_peer_type VARCHAR(30),
                    sender_username TEXT, sender_name TEXT, sender_phone TEXT, message_text TEXT NOT NULL,
                    chat_title TEXT, chat_type VARCHAR(30), message_timestamp TIMESTAMPTZ,
                    detected_at TIMESTAMPTZ DEFAULT NOW(), reply_status VARCHAR(30) DEFAULT 'available',
                    replied_at TIMESTAMPTZ, reply_error TEXT, ignored BOOLEAN DEFAULT false,
                    UNIQUE(telegram_account_id, chat_id, message_id, keyword_id)
                )
            `);
            await query(`
                CREATE TABLE IF NOT EXISTS telegram_keyword_events (
                    id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL, telegram_account_id UUID,
                    event_type VARCHAR(40) NOT NULL, result_id UUID, payload JSONB DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            const keywordIndexes = [
                `CREATE INDEX IF NOT EXISTS idx_tg_keywords_user_active ON telegram_keywords(user_id,is_active)`,
                `CREATE INDEX IF NOT EXISTS idx_tg_results_user_detected ON telegram_keyword_results(user_id,detected_at DESC)`,
                `CREATE INDEX IF NOT EXISTS idx_tg_results_account_chat ON telegram_keyword_results(telegram_account_id,chat_id,message_timestamp DESC)`,
                `CREATE INDEX IF NOT EXISTS idx_tg_results_message ON telegram_keyword_results(message_id)`,
                `CREATE INDEX IF NOT EXISTS idx_tg_events_user_created ON telegram_keyword_events(user_id,created_at DESC)`,
            ];
            for (const idx of keywordIndexes) await query(idx).catch(() => {});

            // ── تنظيف ومنع تكرار حسابات Telegram ─────────────────────────
            // احتفظ بالحساب الأحدث عند وجود تكرارات قديمة، ثم أضف قيوداً جزئية
            // تسمح بالحسابات القديمة التي لا تحتوي على معرف Telegram بعد.
            await query(`
                WITH ranked AS (
                    SELECT id, ROW_NUMBER() OVER (
                        PARTITION BY user_id, telegram_user_id
                        ORDER BY last_connected_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                    ) AS rn
                    FROM telegram_accounts
                    WHERE user_id IS NOT NULL AND telegram_user_id IS NOT NULL AND telegram_user_id <> ''
                )
                DELETE FROM telegram_accounts a USING ranked r
                WHERE a.id = r.id AND r.rn > 1
            `).catch(() => {});
            await query(`
                WITH ranked AS (
                    SELECT id, ROW_NUMBER() OVER (
                        PARTITION BY user_id, phone_number
                        ORDER BY last_connected_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                    ) AS rn
                    FROM telegram_accounts
                    WHERE user_id IS NOT NULL AND phone_number IS NOT NULL AND phone_number <> ''
                )
                DELETE FROM telegram_accounts a USING ranked r
                WHERE a.id = r.id AND r.rn > 1
            `).catch(() => {});
            await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_accounts_user_telegram_unique ON telegram_accounts(user_id,telegram_user_id) WHERE user_id IS NOT NULL AND telegram_user_id IS NOT NULL AND telegram_user_id <> ''`).catch(() => {});
            await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_accounts_user_phone_unique ON telegram_accounts(user_id,phone_number) WHERE user_id IS NOT NULL AND phone_number IS NOT NULL AND phone_number <> ''`).catch(() => {});

            // ── Indexes للأداء ────────────────────────────────────────────
            const indexes = [
                `CREATE INDEX IF NOT EXISTS idx_whatsapp_links_status ON whatsapp_links(status)`,
                `CREATE INDEX IF NOT EXISTS idx_whatsapp_links_discovered ON whatsapp_links(discovered_at DESC)`,
                `CREATE INDEX IF NOT EXISTS idx_whatsapp_links_account ON whatsapp_links(source_account_id)`,
                `CREATE INDEX IF NOT EXISTS idx_whatsapp_links_deleted ON whatsapp_links(deleted)`,
                `CREATE INDEX IF NOT EXISTS idx_telegram_accounts_user ON telegram_accounts(user_id)`,
                `CREATE INDEX IF NOT EXISTS idx_telegram_accounts_status ON telegram_accounts(status)`,
            ];
            for (const idx of indexes) {
                await query(idx).catch(() => {});
            }

            console.log('[TelegramMigrations] Tables ready');
        } catch (err) {
            if (!err.message?.includes('already exists')) {
                console.error('[TelegramMigrations] Error:', err.message);
            }
        }
    }
};

module.exports = TelegramMigrations;
