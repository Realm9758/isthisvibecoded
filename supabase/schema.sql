-- ============================================================
--  Is This Vibe-Coded? — Supabase Schema
--  Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================


-- ── Users ─────────────────────────────────────────────────────────────────

create table if not exists users (
  id                    text primary key,
  email                 text unique not null,
  name                  text not null,
  password_hash         text not null,
  plan                  text not null default 'free'
                          check (plan in ('free', 'pro', 'team')),
  stripe_customer_id    text,o
  stripe_subscription_id text,
  created_at            bigint not null
);

create index if not exists users_email_idx on users (email);
create index if not exists users_stripe_customer_idx on users (stripe_customer_id);


-- ── Scans ─────────────────────────────────────────────────────────────────

create table if not exists scans (
  id          text primary key,
  result      jsonb not null,
  user_id     text references users(id) on delete set null,
  is_public   boolean not null default true,
  roasts      jsonb not null default '[]',
  created_at  bigint not null
);

create index if not exists scans_public_created_idx on scans (is_public, created_at desc);
create index if not exists scans_user_idx on scans (user_id);


-- ── Daily Usage (rate limiting) ────────────────────────────────────────────

create table if not exists daily_usage (
  key    text primary key,   -- format: "<userId-or-ip>:YYYY-MM-DD"
  count  integer not null default 0
);


-- ── increment_usage function ───────────────────────────────────────────────
-- Atomically upserts a usage counter (avoids race conditions).

create or replace function increment_usage(usage_key text)
returns void
language plpgsql
as $$
begin
  insert into daily_usage (key, count)
  values (usage_key, 1)
  on conflict (key) do update
    set count = daily_usage.count + 1;
end;
$$;


-- ── Verification Tokens (ownership proof) ────────────────────────────────

create table if not exists verification_tokens (
  domain      text primary key,
  token       text not null,
  created_at  bigint not null
);


-- ── Deep Scans ───────────────────────────────────────────────────────────

create table if not exists deep_scans (
  id          text primary key,
  domain      text not null,
  user_id     text not null references users(id) on delete cascade,
  result      jsonb not null,
  created_at  bigint not null
);

create index if not exists deep_scans_user_idx on deep_scans (user_id, created_at desc);


-- ── Community Posts ───────────────────────────────────────────────────────
-- Only deep scans where checked[] has no 'fail' items are sharable.
-- The summary snapshot is stored here so the full scan stays private.

create table if not exists community_posts (
  id            text primary key,
  deep_scan_id  text not null references deep_scans(id) on delete cascade,
  user_id       text not null references users(id) on delete cascade,
  domain        text not null,
  caption       text,
  score         integer not null,
  pass_count    integer not null default 0,
  warn_count    integer not null default 0,
  fail_count    integer not null default 0,
  created_at    bigint not null
);

create index if not exists community_posts_created_idx on community_posts (created_at desc);
create index if not exists community_posts_user_idx    on community_posts (user_id);
create index if not exists community_posts_domain_idx  on community_posts (domain);
create unique index if not exists community_posts_scan_uniq on community_posts (deep_scan_id);


-- ── Community Reactions ───────────────────────────────────────────────────

create table if not exists community_reactions (
  post_id   text not null references community_posts(id) on delete cascade,
  user_id   text not null references users(id) on delete cascade,
  type      text not null check (type in ('solid_build', 'interesting_stack', 'surprised')),
  primary key (post_id, user_id, type)
);

create index if not exists community_reactions_post_idx on community_reactions (post_id);


-- ── Row Level Security ─────────────────────────────────────────────────────
-- We use the service_role key server-side, so RLS is disabled.
-- Enable and add policies if you ever expose these tables to client-side code.

-- ── Rank Snapshots ───────────────────────────────────────────────────────
-- Stores one row per domain/category/time_filter per UTC day.
-- Used to compute rank delta (↑3, ↓2) shown on the leaderboard.

create table if not exists rank_snapshots (
  domain        text    not null,
  category      text    not null check (category in ('vibe', 'secure')),
  time_filter   text    not null check (time_filter in ('today', 'week', 'all')),
  rank_position integer not null,
  score         integer not null,
  snapshot_date date    not null default current_date,
  primary key (domain, category, time_filter, snapshot_date)
);

create index if not exists rank_snapshots_date_idx on rank_snapshots (snapshot_date desc);


-- ── Row Level Security ─────────────────────────────────────────────────────

alter table users                disable row level security;
alter table scans                disable row level security;
alter table daily_usage          disable row level security;
alter table verification_tokens  disable row level security;
alter table deep_scans           disable row level security;
alter table community_posts      disable row level security;
alter table community_reactions  disable row level security;
alter table rank_snapshots       disable row level security;
