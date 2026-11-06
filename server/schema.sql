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

-- ---------------------------------------------------------------------------
-- LinkedIn accounts (connected with the "Connect LinkedIn" button, refreshed automatically)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS linkedin_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_id VARCHAR(100) NOT NULL,             -- the company page URN, e.g. urn:li:organization:12345
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    picture_url TEXT,
    access_token TEXT NOT NULL,
    access_token_expires_at TIMESTAMPTZ NOT NULL,
    refresh_token TEXT,                          -- only issued when LinkedIn enables refresh tokens for the app
    refresh_token_expires_at TIMESTAMPTZ,
    scope TEXT,
    last_refresh_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_linkedin_accounts_user_id ON linkedin_accounts(user_id);
ALTER TABLE linkedin_accounts ADD COLUMN IF NOT EXISTS vanity_name VARCHAR(255);  -- linkedin.com/company/<vanity_name>

-- Daily LinkedIn company page metrics (LinkedIn day buckets are UTC days; it keeps 12 months)
CREATE TABLE IF NOT EXISTS li_daily_metrics (
    account_id BIGINT NOT NULL REFERENCES linkedin_accounts(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    impressions BIGINT,
    unique_impressions BIGINT,
    clicks BIGINT,
    likes BIGINT,                 -- all reactions
    comments BIGINT,
    shares BIGINT,                -- reposts
    page_views BIGINT,
    unique_page_views BIGINT,
    desktop_page_views BIGINT,
    mobile_page_views BIGINT,
    organic_follower_gain BIGINT,
    paid_follower_gain BIGINT,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_li_daily_date ON li_daily_metrics(metric_date);

-- ---------------------------------------------------------------------------
-- Social Post: publishing to Instagram, Facebook, LinkedIn and YouTube
-- ---------------------------------------------------------------------------
-- Facebook Pages, connected with the "Connect Facebook" button. Page tokens made from a long-lived user token do not expire.
CREATE TABLE IF NOT EXISTS facebook_pages (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    picture_url TEXT,
    page_access_token TEXT NOT NULL,
    ig_user_id VARCHAR(100),                    -- the Instagram professional account linked to this page, if any
    scope TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_facebook_pages_user_id ON facebook_pages(user_id);

-- LinkedIn can now hold personal profiles (urn:li:person:...) as well as company pages
ALTER TABLE linkedin_accounts ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'organization';

-- Lets us tell whether a stored YouTube refresh token is allowed to upload
ALTER TABLE Youtube_accounts ADD COLUMN IF NOT EXISTS scope TEXT;
ALTER TABLE Youtube_accounts ADD COLUMN IF NOT EXISTS channel_id VARCHAR(100);
ALTER TABLE Youtube_accounts ADD COLUMN IF NOT EXISTS picture_url TEXT;

-- Files uploaded for posts (stored in Google Cloud Storage)
CREATE TABLE IF NOT EXISTS media_assets (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gcs_key TEXT NOT NULL,
    public_url TEXT NOT NULL,
    file_name TEXT,
    mime VARCHAR(100) NOT NULL,
    bytes BIGINT,
    width INTEGER,
    height INTEGER,
    duration_s NUMERIC,
    uploaded BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_media_assets_user ON media_assets(user_id);

-- One post made in the wizard; it fans out to one target per platform account
CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',          -- draft | scheduled | publishing | done | partial | failed
    wizard_state JSONB NOT NULL DEFAULT '{}'::jsonb,      -- everything the wizard needs to reopen the draft
    schedule_at TIMESTAMPTZ,
    timezone VARCHAR(60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_targets (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL,                         -- instagram | facebook | linkedin | youtube
    account_id BIGINT NOT NULL,
    post_type VARCHAR(30) NOT NULL,
    fields JSONB NOT NULL DEFAULT '{}'::jsonb,             -- the final per-platform payload
    status VARCHAR(20) NOT NULL DEFAULT 'pending',         -- pending | scheduled | publishing | done | failed
    step VARCHAR(20),                                      -- upload | container | poll | publish | done
    schedule_at TIMESTAMPTZ,
    native_scheduled BOOLEAN NOT NULL DEFAULT FALSE,       -- the platform itself holds the schedule (Facebook, YouTube)
    external_id TEXT,
    permalink TEXT,
    error_code INTEGER,
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_post_targets_post ON post_targets(post_id);
CREATE INDEX IF NOT EXISTS idx_post_targets_due ON post_targets(status, schedule_at);

-- Auto-replies made for one post in the wizard
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS post_target_id BIGINT REFERENCES post_targets(id) ON DELETE SET NULL;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS public_reply_variants TEXT[];
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS send_dm BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS dm_buttons JSONB;               -- [{ title, url }]
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS quick_replies JSONB;            -- [{ title }]
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS require_follow BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS active_from TIMESTAMPTZ;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS active_until TIMESTAMPTZ;
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS keyword_matched TEXT;
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS public_reply_text TEXT;
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS retry_at TIMESTAMPTZ;
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS comment_id VARCHAR(120);
ALTER TABLE post_targets ADD COLUMN IF NOT EXISTS note TEXT;           -- e.g. "Thumbnail not set: …" when the post itself succeeded
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- Instagram long-lived tokens are renewed automatically (every 7 days, each renewal lasts 60 days)
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS token_refreshed_at TIMESTAMPTZ;
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS last_refresh_error TEXT;
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS last_refresh_failed_at TIMESTAMPTZ;

-- LinkedIn: wait before retrying a failed token renewal
ALTER TABLE linkedin_accounts ADD COLUMN IF NOT EXISTS last_refresh_failed_at TIMESTAMPTZ;
-- Set when LinkedIn rejects the token and renewing with the refresh token fails too: the user must reconnect
ALTER TABLE linkedin_accounts ADD COLUMN IF NOT EXISTS token_invalid_at TIMESTAMPTZ;
-- The LinkedIn app (client id) that issued the stored tokens. A refresh token only works with that app, so a copy of
-- this site running with a different LinkedIn app (sharing the database) must not try to renew or flag them.
ALTER TABLE linkedin_accounts ADD COLUMN IF NOT EXISTS client_id VARCHAR(100);
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Step-by-step log of Connect Instagram / Connect Facebook attempts, shown on the Accounts page.
-- In the database (not a file) so a sign-in started on one server and finished on another reads as one story.
CREATE TABLE IF NOT EXISTS oauth_log (
    id BIGSERIAL PRIMARY KEY,
    flow_id VARCHAR(32) NOT NULL,
    platform VARCHAR(20) NOT NULL,
    user_id BIGINT,
    seq INTEGER NOT NULL,
    step TEXT NOT NULL,
    details JSONB,
    server VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS oauth_log_user_idx ON oauth_log (user_id, id DESC);

-- ---------------------------------------------------------------------------
-- Facebook Page insights: one row per Page per day (same idea as ig_/yt_/li_daily_metrics).
-- NULL = Facebook did not return that metric; 0 = it did, and nothing happened that day.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fb_daily_metrics (
    account_id BIGINT NOT NULL REFERENCES facebook_pages(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    views BIGINT,                  -- page_media_view
    reach BIGINT,                  -- page_total_media_view_unique
    engagements BIGINT,            -- page_post_engagements
    reactions BIGINT,              -- page_actions_post_reactions_total (all types)
    follows BIGINT,
    unfollows BIGINT,
    followers_total BIGINT,        -- running total at the end of the day
    page_visits BIGINT,
    actions BIGINT,                -- clicks on contact info / call-to-action button
    new_conversations BIGINT,
    video_views BIGINT,
    video_views_organic BIGINT,
    video_views_paid BIGINT,
    video_autoplayed BIGINT,
    video_click_to_play BIGINT,
    video_complete_30s BIGINT,
    video_repeat_views BIGINT,
    watch_minutes NUMERIC,
    views_followers BIGINT,        -- page_media_view broken down by is_from_followers
    views_non_followers BIGINT,
    views_organic BIGINT,          -- page_media_view broken down by is_from_ads
    views_ads BIGINT,
    reactions_by_type JSONB,       -- e.g. {"like": 3, "love": 1}
    synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_fb_daily_date ON fb_daily_metrics(metric_date);
