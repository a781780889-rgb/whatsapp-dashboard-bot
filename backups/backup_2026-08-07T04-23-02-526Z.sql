--
-- PostgreSQL database dump
--

\restrict a8e7DQu2nUx67QqnEJrnbtvh87IJPeGFcJ0bW319x1QIffJmTaBIMgkG3reWQih

-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026;


ALTER SCHEMA acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026 OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_logs; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.account_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    level character varying(20) DEFAULT 'info'::character varying,
    message text,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.account_logs OWNER TO postgres;

--
-- Name: ad_library; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.ad_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    content text DEFAULT ''::text,
    media_paths jsonb DEFAULT '[]'::jsonb,
    media_types jsonb DEFAULT '[]'::jsonb,
    links jsonb DEFAULT '[]'::jsonb,
    format_options jsonb DEFAULT '{}'::jsonb,
    priority integer DEFAULT 5,
    tags text DEFAULT ''::text,
    is_active boolean DEFAULT true,
    use_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.ad_library OWNER TO postgres;

--
-- Name: baileys_events; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.baileys_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(100),
    success boolean DEFAULT true,
    error_message text,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.baileys_events OWNER TO postgres;

--
-- Name: broadcast_schedules; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.broadcast_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    account_id text,
    status character varying(50) DEFAULT 'paused'::character varying,
    target_group_jids jsonb DEFAULT '[]'::jsonb,
    ad_library_ids jsonb DEFAULT '[]'::jsonb,
    rotation_mode character varying(50) DEFAULT 'sequential'::character varying,
    active_days jsonb DEFAULT '[0, 1, 2, 3, 4, 5, 6]'::jsonb,
    publish_times jsonb DEFAULT '[]'::jsonb,
    max_per_day integer DEFAULT 3,
    send_to_members boolean DEFAULT false,
    exclude_admins boolean DEFAULT true,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.broadcast_schedules OWNER TO postgres;

--
-- Name: business_api_settings; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.business_api_settings (
    id integer DEFAULT 1 NOT NULL,
    phone_number_id text,
    access_token text,
    webhook_verify_token text,
    settings jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.business_api_settings OWNER TO postgres;

--
-- Name: campaigns; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    status character varying(50) DEFAULT 'pending'::character varying,
    target_groups jsonb DEFAULT '[]'::jsonb,
    ad_library_id uuid,
    sent_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    total_targets integer DEFAULT 0,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.campaigns OWNER TO postgres;

--
-- Name: connection_attempts; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.connection_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status character varying(50),
    method character varying(50),
    duration_ms integer,
    error_message text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.connection_attempts OWNER TO postgres;

--
-- Name: diagnostics; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.diagnostics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report jsonb,
    score integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.diagnostics OWNER TO postgres;

--
-- Name: direct_publish_log; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.direct_publish_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id text,
    ad_library_id uuid,
    target_group_jids jsonb DEFAULT '[]'::jsonb,
    custom_content text DEFAULT ''::text,
    status character varying(50) DEFAULT 'sent'::character varying,
    send_to_members boolean DEFAULT false,
    exclude_admins boolean DEFAULT true,
    members_sent integer DEFAULT 0,
    sent_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    ad_library_ids jsonb DEFAULT '[]'::jsonb,
    groups_targeted integer DEFAULT 0,
    groups_sent integer DEFAULT 0,
    groups_failed integer DEFAULT 0,
    members_targeted integer DEFAULT 0,
    members_failed integer DEFAULT 0,
    member_delay_ms integer DEFAULT 1500,
    details jsonb DEFAULT '[]'::jsonb
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.direct_publish_log OWNER TO postgres;

--
-- Name: group_exclusions; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.group_exclusions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.group_exclusions OWNER TO postgres;

--
-- Name: group_members; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.group_members (
    group_id text NOT NULL,
    phone text NOT NULL,
    name text,
    is_admin boolean DEFAULT false,
    joined_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.group_members OWNER TO postgres;

--
-- Name: groups; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.groups (
    id text NOT NULL,
    name text,
    description text,
    participant_count integer DEFAULT 0,
    category text DEFAULT 'general'::text,
    is_active boolean DEFAULT true,
    joined_at timestamp with time zone DEFAULT now(),
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.groups OWNER TO postgres;

--
-- Name: join_queue; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.join_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    link_url text NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    attempts integer DEFAULT 0,
    last_attempt_at timestamp with time zone,
    joined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.join_queue OWNER TO postgres;

--
-- Name: link_join_settings; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.link_join_settings (
    id integer DEFAULT 1 NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.link_join_settings OWNER TO postgres;

--
-- Name: link_search_settings; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.link_search_settings (
    id integer DEFAULT 1 NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.link_search_settings OWNER TO postgres;

--
-- Name: links; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    url text NOT NULL,
    group_id text,
    source_message text,
    category text DEFAULT 'general'::text,
    is_spam boolean DEFAULT false,
    extracted_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.links OWNER TO postgres;

--
-- Name: pairing_attempts; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.pairing_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text,
    code text,
    status character varying(50),
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.pairing_attempts OWNER TO postgres;

--
-- Name: qr_events; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.qr_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attempt_id uuid,
    event_type character varying(50),
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.qr_events OWNER TO postgres;

--
-- Name: schedules; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    status character varying(50) DEFAULT 'active'::character varying,
    cron_expr text,
    ad_library_id uuid,
    target_groups jsonb DEFAULT '[]'::jsonb,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    run_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.schedules OWNER TO postgres;

--
-- Name: schema_migrations; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.schema_migrations (
    version integer NOT NULL,
    name text,
    applied_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.schema_migrations OWNER TO postgres;

--
-- Name: sync_settings; Type: TABLE; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

CREATE TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.sync_settings (
    id integer DEFAULT 1 NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.sync_settings OWNER TO postgres;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name character varying(200) NOT NULL,
    phone_number character varying(50),
    status character varying(50) DEFAULT 'disconnected'::character varying,
    health_status character varying(50) DEFAULT 'unknown'::character varying,
    role character varying(50) DEFAULT 'stopped'::character varying,
    task_status character varying(50) DEFAULT 'idle'::character varying,
    connection_type character varying(50) DEFAULT 'baileys'::character varying,
    messages_sent_today integer DEFAULT 0,
    last_activity_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.accounts OWNER TO postgres;

--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    username character varying(100),
    action character varying(100),
    details text,
    ip_address character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.activity_logs OWNER TO postgres;

--
-- Name: jwt_families; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.jwt_families (
    family_id character varying(200) NOT NULL,
    user_id uuid,
    revoked boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.jwt_families OWNER TO postgres;

--
-- Name: kw_activity_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.kw_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    action character varying(100),
    details text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.kw_activity_log OWNER TO postgres;

--
-- Name: kw_alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.kw_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    keyword_id uuid,
    matched_keyword text NOT NULL,
    message_text text,
    sender_name text,
    sender_phone text,
    group_name text,
    group_jid text,
    account_id uuid,
    message_time timestamp with time zone DEFAULT now(),
    status character varying(30) DEFAULT 'new'::character varying,
    internal_note text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.kw_alerts OWNER TO postgres;

--
-- Name: kw_keywords; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.kw_keywords (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    word text NOT NULL,
    category text DEFAULT 'عام'::text,
    priority character varying(20) DEFAULT 'normal'::character varying,
    color character varying(20) DEFAULT '#00A884'::character varying,
    case_sensitive boolean DEFAULT false,
    is_active boolean DEFAULT true,
    match_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.kw_keywords OWNER TO postgres;

--
-- Name: kw_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.kw_settings (
    user_id uuid NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.kw_settings OWNER TO postgres;

--
-- Name: licenses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.licenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    license_key character varying(100) NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying,
    plan_type character varying(100),
    issued_by uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.licenses OWNER TO postgres;

--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.login_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(100),
    ip_address character varying(100),
    success boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.login_attempts OWNER TO postgres;

--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.refresh_tokens (
    token_hash character varying(500) NOT NULL,
    family_id character varying(200),
    user_id uuid,
    used boolean DEFAULT false,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.refresh_tokens OWNER TO postgres;

--
-- Name: session_data; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.session_data (
    account_id uuid NOT NULL,
    key text NOT NULL,
    value text,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.session_data OWNER TO postgres;

--
-- Name: subscription_renewals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscription_renewals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid,
    plan_type character varying(100),
    extended_hours integer,
    note text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.subscription_renewals OWNER TO postgres;

--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    plan_type character varying(100) NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying,
    max_accounts integer DEFAULT 1,
    expires_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    enable_telegram boolean DEFAULT false
);


ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- Name: telegram_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.telegram_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name character varying(200) NOT NULL,
    phone_number character varying(50),
    api_id character varying(100),
    api_hash character varying(200),
    session_string text,
    bot_token text,
    bot_username character varying(100),
    status character varying(50) DEFAULT 'disconnected'::character varying,
    last_activity_at timestamp with time zone,
    links_collected integer DEFAULT 0,
    channels_monitored integer DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.telegram_accounts OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(100) NOT NULL,
    password text NOT NULL,
    full_name character varying(200),
    email character varying(200),
    role character varying(50) DEFAULT 'user'::character varying,
    status character varying(50) DEFAULT 'active'::character varying,
    mfa_enabled boolean DEFAULT false,
    mfa_secret text,
    failed_login_count integer DEFAULT 0,
    last_failed_login timestamp with time zone,
    locked_until timestamp with time zone,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: whatsapp_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.whatsapp_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    whatsapp_link text NOT NULL,
    source_account_id uuid,
    source_account_name character varying(200),
    source_group character varying(500),
    source_channel character varying(500),
    discovered_at timestamp with time zone DEFAULT now(),
    last_seen timestamp with time zone DEFAULT now(),
    duplicate_count integer DEFAULT 0,
    status character varying(50) DEFAULT 'new'::character varying,
    joined boolean DEFAULT false,
    copied boolean DEFAULT false,
    deleted boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.whatsapp_links OWNER TO postgres;

--
-- Data for Name: account_logs; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.account_logs (id, level, message, details, created_at) FROM stdin;
\.


--
-- Data for Name: ad_library; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.ad_library (id, name, content, media_paths, media_types, links, format_options, priority, tags, is_active, use_count, created_at, updated_at, last_used_at) FROM stdin;
71c83795-690e-4f05-a238-263a94382041	Ad1		[]	[]	[]	{}	5		t	0	2026-08-07 04:22:47.885417+00	2026-08-07 04:22:47.885417+00	\N
\.


--
-- Data for Name: baileys_events; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.baileys_events (id, event_type, success, error_message, details, created_at) FROM stdin;
\.


--
-- Data for Name: broadcast_schedules; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.broadcast_schedules (id, name, account_id, status, target_group_jids, ad_library_ids, rotation_mode, active_days, publish_times, max_per_day, send_to_members, exclude_admins, next_run_at, last_run_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: business_api_settings; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.business_api_settings (id, phone_number_id, access_token, webhook_verify_token, settings, updated_at) FROM stdin;
\.


--
-- Data for Name: campaigns; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.campaigns (id, name, status, target_groups, ad_library_id, sent_count, failed_count, total_targets, started_at, finished_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: connection_attempts; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.connection_attempts (id, status, method, duration_ms, error_message, created_at) FROM stdin;
\.


--
-- Data for Name: diagnostics; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.diagnostics (id, report, score, created_at) FROM stdin;
\.


--
-- Data for Name: direct_publish_log; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.direct_publish_log (id, account_id, ad_library_id, target_group_jids, custom_content, status, send_to_members, exclude_admins, members_sent, sent_at, created_at, ad_library_ids, groups_targeted, groups_sent, groups_failed, members_targeted, members_failed, member_delay_ms, details) FROM stdin;
\.


--
-- Data for Name: group_exclusions; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.group_exclusions (id, phone, reason, created_at) FROM stdin;
\.


--
-- Data for Name: group_members; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.group_members (group_id, phone, name, is_admin, joined_at) FROM stdin;
\.


--
-- Data for Name: groups; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.groups (id, name, description, participant_count, category, is_active, joined_at, last_sync_at, created_at, updated_at) FROM stdin;
g1	Grp1	\N	0	general	t	2026-08-07 04:22:47.885417+00	\N	2026-08-07 04:22:47.885417+00	2026-08-07 04:22:47.885417+00
g2	Grp2	\N	0	general	t	2026-08-07 04:22:47.885417+00	\N	2026-08-07 04:22:47.885417+00	2026-08-07 04:22:47.885417+00
\.


--
-- Data for Name: join_queue; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.join_queue (id, link_url, status, attempts, last_attempt_at, joined_at, created_at) FROM stdin;
\.


--
-- Data for Name: link_join_settings; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.link_join_settings (id, settings, updated_at) FROM stdin;
\.


--
-- Data for Name: link_search_settings; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.link_search_settings (id, settings, updated_at) FROM stdin;
\.


--
-- Data for Name: links; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.links (id, url, group_id, source_message, category, is_spam, extracted_at, created_at) FROM stdin;
\.


--
-- Data for Name: pairing_attempts; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.pairing_attempts (id, phone, code, status, latency_ms, created_at) FROM stdin;
\.


--
-- Data for Name: qr_events; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.qr_events (id, attempt_id, event_type, latency_ms, created_at) FROM stdin;
\.


--
-- Data for Name: schedules; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.schedules (id, name, status, cron_expr, ad_library_id, target_groups, next_run_at, last_run_at, run_count, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.schema_migrations (version, name, applied_at) FROM stdin;
\.


--
-- Data for Name: sync_settings; Type: TABLE DATA; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

COPY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.sync_settings (id, settings, updated_at) FROM stdin;
\.


--
-- Data for Name: accounts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.accounts (id, user_id, name, phone_number, status, health_status, role, task_status, connection_type, messages_sent_today, last_activity_at, created_at, updated_at) FROM stdin;
367193a8-01e9-4b4b-8cc9-2a47cf76c026	54a981b5-41e7-4799-8fcc-430a45d7b57b	Test Account	+967781780889	disconnected	unknown	stopped	idle	baileys	0	\N	2026-08-07 04:22:43.001729+00	2026-08-07 04:22:43.001729+00
\.


--
-- Data for Name: activity_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.activity_logs (id, user_id, username, action, details, ip_address, created_at) FROM stdin;
a56ff8a6-f9b3-487e-9d6c-f506f432bc38	54a981b5-41e7-4799-8fcc-430a45d7b57b	admin	LOGIN_SUCCESS	IP: ::1	::1	2026-08-07 04:22:16.795326+00
a35db260-338c-4021-aac1-617a1166347c	\N	testuser	LOGIN_FAILED	User not found. IP: ::1	::1	2026-08-07 04:22:16.831833+00
0c3116d9-1a0e-454d-8fad-a3d246f304d5	54a981b5-41e7-4799-8fcc-430a45d7b57b	admin	LOGIN_SUCCESS	IP: ::1	::1	2026-08-07 04:22:21.354224+00
97443ef9-f43e-4f21-a1c3-af3a94f7b4fa	54a981b5-41e7-4799-8fcc-430a45d7b57b	admin	LOGIN_SUCCESS	IP: ::1	::1	2026-08-07 04:22:21.714325+00
40adae82-a205-41eb-9cad-7cebe4406215	54a981b5-41e7-4799-8fcc-430a45d7b57b	admin	LOGIN_SUCCESS	IP: ::1	::1	2026-08-07 04:22:42.984276+00
\.


--
-- Data for Name: jwt_families; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.jwt_families (family_id, user_id, revoked, created_at) FROM stdin;
\.


--
-- Data for Name: kw_activity_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.kw_activity_log (id, user_id, action, details, created_at) FROM stdin;
\.


--
-- Data for Name: kw_alerts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.kw_alerts (id, user_id, keyword_id, matched_keyword, message_text, sender_name, sender_phone, group_name, group_jid, account_id, message_time, status, internal_note, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: kw_keywords; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.kw_keywords (id, user_id, word, category, priority, color, case_sensitive, is_active, match_count, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: kw_settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.kw_settings (user_id, settings, updated_at) FROM stdin;
\.


--
-- Data for Name: licenses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.licenses (id, user_id, license_key, status, plan_type, issued_by, expires_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: login_attempts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.login_attempts (id, username, ip_address, success, created_at) FROM stdin;
962bc0dc-99b7-4dbc-92dd-2730780bf977	admin	::1	t	2026-08-07 04:22:16.793604+00
8e57ad02-8470-4a8d-a847-cf8cb6994f9d	testuser	::1	f	2026-08-07 04:22:16.831129+00
bc5af0ad-b3ad-4528-b7ba-aaf1a412d48a	admin	::1	t	2026-08-07 04:22:21.352984+00
4f7d4eb7-3ba6-4aa4-8784-daf27bae5ea6	admin	::1	t	2026-08-07 04:22:21.713499+00
cc61c79e-8395-4a12-97fe-0f48971876fb	admin	::1	t	2026-08-07 04:22:42.98322+00
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.refresh_tokens (token_hash, family_id, user_id, used, expires_at, created_at) FROM stdin;
f423e5c9ca88aaeb75b439f7d9b8984d8a953e53928824e6d0c0016ac2ea78ce	2668e08d-3dfe-45a8-acd8-9b9a951abba4	54a981b5-41e7-4799-8fcc-430a45d7b57b	f	2026-08-14 04:22:16.795+00	2026-08-07 04:22:16.800169+00
4426c338ee053ababd0e62ea74e59cbd3d91072a80e50f26f9c3576b0f1e9174	fafef774-183a-4a8d-bd6b-27f67fa55edc	54a981b5-41e7-4799-8fcc-430a45d7b57b	f	2026-08-14 04:22:21.354+00	2026-08-07 04:22:21.358082+00
366537a7d547e60e16faed2ac80e63d0ac307f4f5f4c9f89c1d3c631e1344763	1656907a-16b5-4500-a79f-3d5fa91df120	54a981b5-41e7-4799-8fcc-430a45d7b57b	f	2026-08-14 04:22:21.714+00	2026-08-07 04:22:21.717007+00
a1b59720ae0fe61c5f9d8c3469cbfe033ad767048037ae95465cc817c3d367f2	3dcba20b-599a-4bcf-a7e5-5ce653625ff8	54a981b5-41e7-4799-8fcc-430a45d7b57b	f	2026-08-14 04:22:42.984+00	2026-08-07 04:22:42.986688+00
\.


--
-- Data for Name: session_data; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.session_data (account_id, key, value, updated_at) FROM stdin;
\.


--
-- Data for Name: subscription_renewals; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subscription_renewals (id, subscription_id, plan_type, extended_hours, note, created_at) FROM stdin;
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subscriptions (id, user_id, plan_type, status, max_accounts, expires_at, notes, created_at, updated_at, enable_telegram) FROM stdin;
\.


--
-- Data for Name: telegram_accounts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.telegram_accounts (id, user_id, name, phone_number, api_id, api_hash, session_string, bot_token, bot_username, status, last_activity_at, links_collected, channels_monitored, notes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, password, full_name, email, role, status, mfa_enabled, mfa_secret, failed_login_count, last_failed_login, locked_until, last_login, created_at, updated_at) FROM stdin;
54a981b5-41e7-4799-8fcc-430a45d7b57b	admin	$2b$12$pmCVVpzkasUmW0tGV/kB5e/dqHdOZtHCIzGcR0VHok2g64oSVRABS	Super Admin	\N	super_admin	active	f	\N	0	\N	\N	2026-08-07 04:22:42.983698+00	2026-08-07 04:22:02.498425+00	2026-08-07 04:22:02.498425+00
\.


--
-- Data for Name: whatsapp_links; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.whatsapp_links (id, whatsapp_link, source_account_id, source_account_name, source_group, source_channel, discovered_at, last_seen, duplicate_count, status, joined, copied, deleted, notes, created_at, updated_at) FROM stdin;
\.


--
-- Name: account_logs account_logs_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.account_logs
    ADD CONSTRAINT account_logs_pkey PRIMARY KEY (id);


--
-- Name: ad_library ad_library_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.ad_library
    ADD CONSTRAINT ad_library_pkey PRIMARY KEY (id);


--
-- Name: baileys_events baileys_events_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.baileys_events
    ADD CONSTRAINT baileys_events_pkey PRIMARY KEY (id);


--
-- Name: broadcast_schedules broadcast_schedules_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.broadcast_schedules
    ADD CONSTRAINT broadcast_schedules_pkey PRIMARY KEY (id);


--
-- Name: business_api_settings business_api_settings_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.business_api_settings
    ADD CONSTRAINT business_api_settings_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: connection_attempts connection_attempts_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.connection_attempts
    ADD CONSTRAINT connection_attempts_pkey PRIMARY KEY (id);


--
-- Name: diagnostics diagnostics_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.diagnostics
    ADD CONSTRAINT diagnostics_pkey PRIMARY KEY (id);


--
-- Name: direct_publish_log direct_publish_log_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.direct_publish_log
    ADD CONSTRAINT direct_publish_log_pkey PRIMARY KEY (id);


--
-- Name: group_exclusions group_exclusions_phone_key; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.group_exclusions
    ADD CONSTRAINT group_exclusions_phone_key UNIQUE (phone);


--
-- Name: group_exclusions group_exclusions_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.group_exclusions
    ADD CONSTRAINT group_exclusions_pkey PRIMARY KEY (id);


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (group_id, phone);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: join_queue join_queue_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.join_queue
    ADD CONSTRAINT join_queue_pkey PRIMARY KEY (id);


--
-- Name: link_join_settings link_join_settings_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.link_join_settings
    ADD CONSTRAINT link_join_settings_pkey PRIMARY KEY (id);


--
-- Name: link_search_settings link_search_settings_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.link_search_settings
    ADD CONSTRAINT link_search_settings_pkey PRIMARY KEY (id);


--
-- Name: links links_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.links
    ADD CONSTRAINT links_pkey PRIMARY KEY (id);


--
-- Name: pairing_attempts pairing_attempts_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.pairing_attempts
    ADD CONSTRAINT pairing_attempts_pkey PRIMARY KEY (id);


--
-- Name: qr_events qr_events_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.qr_events
    ADD CONSTRAINT qr_events_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sync_settings sync_settings_pkey; Type: CONSTRAINT; Schema: acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026; Owner: postgres
--

ALTER TABLE ONLY acc_367193a8_01e9_4b4b_8cc9_2a47cf76c026.sync_settings
    ADD CONSTRAINT sync_settings_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: jwt_families jwt_families_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.jwt_families
    ADD CONSTRAINT jwt_families_pkey PRIMARY KEY (family_id);


--
-- Name: kw_activity_log kw_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kw_activity_log
    ADD CONSTRAINT kw_activity_log_pkey PRIMARY KEY (id);


--
-- Name: kw_alerts kw_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kw_alerts
    ADD CONSTRAINT kw_alerts_pkey PRIMARY KEY (id);


--
-- Name: kw_keywords kw_keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kw_keywords
    ADD CONSTRAINT kw_keywords_pkey PRIMARY KEY (id);


--
-- Name: kw_settings kw_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kw_settings
    ADD CONSTRAINT kw_settings_pkey PRIMARY KEY (user_id);


--
-- Name: licenses licenses_license_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.licenses
    ADD CONSTRAINT licenses_license_key_key UNIQUE (license_key);


--
-- Name: licenses licenses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.licenses
    ADD CONSTRAINT licenses_pkey PRIMARY KEY (id);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: session_data session_data_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session_data
    ADD CONSTRAINT session_data_pkey PRIMARY KEY (account_id, key);


--
-- Name: subscription_renewals subscription_renewals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscription_renewals
    ADD CONSTRAINT subscription_renewals_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);


--
-- Name: telegram_accounts telegram_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_accounts
    ADD CONSTRAINT telegram_accounts_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: whatsapp_links whatsapp_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.whatsapp_links
    ADD CONSTRAINT whatsapp_links_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_links whatsapp_links_whatsapp_link_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.whatsapp_links
    ADD CONSTRAINT whatsapp_links_whatsapp_link_key UNIQUE (whatsapp_link);


--
-- Name: idx_accounts_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accounts_user_id ON public.accounts USING btree (user_id);


--
-- Name: idx_kw_activity_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_kw_activity_user ON public.kw_activity_log USING btree (user_id, created_at DESC);


--
-- Name: idx_kw_alerts_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_kw_alerts_status ON public.kw_alerts USING btree (user_id, status);


--
-- Name: idx_kw_alerts_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_kw_alerts_user ON public.kw_alerts USING btree (user_id, message_time DESC);


--
-- Name: idx_kw_keywords_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_kw_keywords_user ON public.kw_keywords USING btree (user_id);


--
-- Name: idx_refresh_tokens_family_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_refresh_tokens_family_id ON public.refresh_tokens USING btree (family_id);


--
-- Name: idx_refresh_tokens_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_refresh_tokens_user_id ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_subscriptions_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_subscriptions_status ON public.subscriptions USING btree (status, expires_at);


--
-- Name: idx_subscriptions_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);


--
-- Name: idx_telegram_accounts_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_telegram_accounts_status ON public.telegram_accounts USING btree (status);


--
-- Name: idx_telegram_accounts_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_telegram_accounts_user ON public.telegram_accounts USING btree (user_id);


--
-- Name: idx_whatsapp_links_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_whatsapp_links_account ON public.whatsapp_links USING btree (source_account_id);


--
-- Name: idx_whatsapp_links_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_whatsapp_links_deleted ON public.whatsapp_links USING btree (deleted);


--
-- Name: idx_whatsapp_links_discovered; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_whatsapp_links_discovered ON public.whatsapp_links USING btree (discovered_at DESC);


--
-- Name: idx_whatsapp_links_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_whatsapp_links_status ON public.whatsapp_links USING btree (status);


--
-- PostgreSQL database dump complete
--

\unrestrict a8e7DQu2nUx67QqnEJrnbtvh87IJPeGFcJ0bW319x1QIffJmTaBIMgkG3reWQih

