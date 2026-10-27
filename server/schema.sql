-- PostgreSQL Schema Definition for CMS Application

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email_address VARCHAR(255) NOT NULL UNIQUE,
    phone_number VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create instagram_accounts table
CREATE TABLE IF NOT EXISTS instagram_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    page_name VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    page_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_instagram_accounts_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- Create Youtube_accounts table
CREATE TABLE IF NOT EXISTS Youtube_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    channel_name VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    playlist_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_youtube_accounts_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- Create Indexes for optimization
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email_address);
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_user_id ON instagram_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_youtube_accounts_user_id ON Youtube_accounts(user_id);

-- Daily Instagram account metrics (one row per account per IST day)
CREATE TABLE IF NOT EXISTS ig_daily_metrics (
    account_id BIGINT NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    reach BIGINT,
    views BIGINT,
    likes BIGINT,
    comments BIGINT,
    saves BIGINT,
    shares BIGINT,
    total_interactions BIGINT,
    accounts_engaged BIGINT,
    profile_links_taps BIGINT,
    follower_change BIGINT,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, metric_date)
);

-- Daily YouTube channel metrics
CREATE TABLE IF NOT EXISTS yt_daily_metrics (
    account_id BIGINT NOT NULL REFERENCES Youtube_accounts(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    views BIGINT,
    likes BIGINT,
    comments BIGINT,
    shares BIGINT,
    minutes_watched BIGINT,
    subs_gained BIGINT,
    subs_lost BIGINT,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, metric_date)
);

-- Per-post / per-video metric snapshots, one row per item per capture day
CREATE TABLE IF NOT EXISTS media_snapshots (
    platform VARCHAR(20) NOT NULL,
    account_id BIGINT NOT NULL,
    media_id VARCHAR(100) NOT NULL,
    captured_on DATE NOT NULL,
    title TEXT,
    media_type VARCHAR(40),
    permalink TEXT,
    thumbnail_url TEXT,
    published_at TIMESTAMPTZ,
    reach BIGINT,
    views BIGINT,
    likes BIGINT,
    comments BIGINT,
    saves BIGINT,
    shares BIGINT,
    PRIMARY KEY (platform, account_id, media_id, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_ig_daily_date ON ig_daily_metrics(metric_date);
CREATE INDEX IF NOT EXISTS idx_yt_daily_date ON yt_daily_metrics(metric_date);
CREATE INDEX IF NOT EXISTS idx_media_snapshots_acct ON media_snapshots(platform, account_id, captured_on);

-- ---------------------------------------------------------------------------
-- Deeper metrics (additive; safe to re-run)
-- ---------------------------------------------------------------------------
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS total_interactions BIGINT;
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS reposts BIGINT;
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS profile_visits BIGINT;
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS follows BIGINT;
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS replies BIGINT;
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS link_clicks BIGINT;
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS skip_rate NUMERIC;            -- percent of plays skipped in the first 3 seconds (reels)
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS avg_watch_seconds NUMERIC;    -- reels average watch time
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS total_watch_seconds NUMERIC;  -- reels total play time incl. replays
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;     -- YouTube video length
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS extra JSONB;                  -- breakdowns, YouTube per-video analytics, anything else

ALTER TABLE ig_daily_metrics ADD COLUMN IF NOT EXISTS replies BIGINT;
ALTER TABLE ig_daily_metrics ADD COLUMN IF NOT EXISTS reposts BIGINT;

ALTER TABLE yt_daily_metrics ADD COLUMN IF NOT EXISTS engaged_views BIGINT;
ALTER TABLE yt_daily_metrics ADD COLUMN IF NOT EXISTS avg_view_duration NUMERIC;
ALTER TABLE yt_daily_metrics ADD COLUMN IF NOT EXISTS avg_view_percentage NUMERIC;
ALTER TABLE yt_daily_metrics ADD COLUMN IF NOT EXISTS playlist_adds BIGINT;
ALTER TABLE yt_daily_metrics ADD COLUMN IF NOT EXISTS playlist_removes BIGINT;
ALTER TABLE yt_daily_metrics ADD COLUMN IF NOT EXISTS dislikes BIGINT;
ALTER TABLE yt_daily_metrics ADD COLUMN IF NOT EXISTS card_impressions BIGINT;
ALTER TABLE yt_daily_metrics ADD COLUMN IF NOT EXISTS card_clicks BIGINT;
ALTER TABLE yt_daily_metrics ADD COLUMN IF NOT EXISTS premium_views BIGINT;

-- ---------------------------------------------------------------------------
-- Instagram keyword auto-replies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_rules (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    triggers TEXT[] NOT NULL DEFAULT ARRAY['comment','dm'],
    keywords TEXT[] NOT NULL,
    match_type VARCHAR(20) NOT NULL DEFAULT 'contains',
    media_id VARCHAR(40),
    reply_text TEXT NOT NULL DEFAULT '',
    link_url TEXT NOT NULL DEFAULT '',
    comment_reply_text TEXT,
    disclose_automation BOOLEAN NOT NULL DEFAULT TRUE,
    cooldown_hours INTEGER NOT NULL DEFAULT 24,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per handled comment / message: doubles as the dedupe key (webhooks are retried) and the activity log
CREATE TABLE IF NOT EXISTS automation_events (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
    rule_id BIGINT REFERENCES automation_rules(id) ON DELETE SET NULL,
    source VARCHAR(10) NOT NULL,
    event_key VARCHAR(120) NOT NULL,
    sender_id VARCHAR(60),
    sender_username VARCHAR(120),
    trigger_text TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'processing',
    skip_reason VARCHAR(60),
    error_code INTEGER,
    error_message TEXT,
    message_id VARCHAR(120),
    message_text TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, source, event_key)
);

-- Instagram webhooks identify the account by its professional account id (user_id), not the id the API returns as `id`
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS ig_user_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_ig_user_id ON instagram_accounts(ig_user_id);

CREATE INDEX IF NOT EXISTS idx_automation_rules_account ON automation_rules(account_id);
CREATE INDEX IF NOT EXISTS idx_automation_events_cooldown ON automation_events(rule_id, sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_automation_events_account_time ON automation_events(account_id, created_at DESC);

-- Rules can target everything, all reels, all posts, or one specific reel/post
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'all';
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS media_label TEXT;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS media_permalink TEXT;
UPDATE automation_rules SET scope = 'specific' WHERE media_id IS NOT NULL AND scope = 'all';
