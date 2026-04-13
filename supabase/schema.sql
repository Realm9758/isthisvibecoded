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


-- ── Row Level Security ─────────────────────────────────────────────────────
-- We use the service_role key server-side, so RLS is disabled.
-- Enable and add policies if you ever expose these tables to client-side code.

alter table users                disable row level security;
alter table scans                disable row level security;
alter table daily_usage          disable row level security;
alter table verification_tokens  disable row level security;
