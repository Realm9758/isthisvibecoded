-- ============================================================
-- VibeScan -- Supabase schema and in-place migration
--
-- Safe to run more than once from the Supabase SQL editor.  The app stores
-- JavaScript Date.now() values, so application timestamps are BIGINT
-- milliseconds rather than PostgreSQL timestamptz values.
-- ============================================================

begin;


-- Users -------------------------------------------------------------------

create table if not exists public.users (
  id                       text primary key,
  email                    text not null,
  name                     text not null,
  password_hash            text not null,
  plan                     text not null default 'free',
  avatar_color             text,
  avatar_url               text,
  bio                      text,
  notif_email              boolean not null default false,
  notif_inapp              boolean not null default true,
  policy_version           text,
  policy_accepted_at       bigint,
  stripe_customer_id       text,
  stripe_subscription_id   text,
  created_at               bigint not null,
  constraint users_plan_check
    check (plan in ('free', 'pro', 'team')),
  constraint users_name_length_check
    check (char_length(btrim(name)) between 1 and 40),
  constraint users_email_normalized_check
    check (email = lower(btrim(email)) and char_length(email) > 0),
  constraint users_password_hash_check
    check (char_length(password_hash) > 0),
  constraint users_bio_length_check
    check (bio is null or char_length(bio) <= 200),
  constraint users_avatar_url_length_check
    check (avatar_url is null or char_length(avatar_url) <= 600000),
  constraint users_created_at_check
    check (created_at >= 0)
);

-- Columns introduced after the first release.  CREATE TABLE IF NOT EXISTS
-- does not add them to an existing installation.
alter table public.users
  add column if not exists avatar_color text,
  add column if not exists avatar_url text,
  add column if not exists bio text,
  add column if not exists notif_email boolean not null default false,
  add column if not exists notif_inapp boolean not null default true,
  add column if not exists policy_version text,
  add column if not exists policy_accepted_at bigint,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

alter table public.users
  alter column plan set default 'free',
  alter column notif_email set default false,
  alter column notif_inapp set default true;

-- Login and public profile lookups both assume a single matching row.
create unique index if not exists users_email_ci_key
  on public.users (lower(email));
create index if not exists users_email_idx
  on public.users (email);
create unique index if not exists users_name_ci_key
  on public.users (lower(name));
create unique index if not exists users_stripe_customer_id_key
  on public.users (stripe_customer_id)
  where stripe_customer_id is not null;
create unique index if not exists users_stripe_subscription_id_key
  on public.users (stripe_subscription_id)
  where stripe_subscription_id is not null;


-- Passive scans -----------------------------------------------------------

create table if not exists public.scans (
  id          text primary key,
  result      jsonb not null,
  user_id     text,
  is_public   boolean not null default false,
  roasts      jsonb not null default '[]'::jsonb,
  created_at  bigint not null,
  constraint scans_user_id_fkey
    foreign key (user_id) references public.users(id) on delete set null,
  constraint scans_result_object_check
    check (jsonb_typeof(result) = 'object'),
  constraint scans_roasts_array_check
    check (jsonb_typeof(roasts) = 'array'),
  constraint scans_created_at_check
    check (created_at >= 0)
);

alter table public.scans
  add column if not exists user_id text,
  add column if not exists is_public boolean not null default false,
  add column if not exists roasts jsonb not null default '[]'::jsonb;

alter table public.scans
  alter column is_public set default false,
  alter column roasts set default '[]'::jsonb;

create index if not exists scans_public_created_idx
  on public.scans (is_public, created_at desc);
create index if not exists scans_user_created_idx
  on public.scans (user_id, created_at desc);
create index if not exists scans_created_at_idx
  on public.scans (created_at desc);


-- Daily usage / rate limiting --------------------------------------------

create table if not exists public.daily_usage (
  key    text primary key,
  count  integer not null default 0,
  constraint daily_usage_key_check
    check (char_length(btrim(key)) > 0),
  constraint daily_usage_count_check
    check (count >= 0)
);

alter table public.daily_usage
  add column if not exists count integer not null default 0;

alter table public.daily_usage
  alter column count set default 0;

-- A single statement handles concurrent requests without a read/write race.
create or replace function public.increment_usage(usage_key text)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if usage_key is null or char_length(btrim(usage_key)) = 0 then
    raise exception 'usage_key must not be empty';
  end if;

  insert into public.daily_usage as usage (key, count)
  values (usage_key, 1)
  on conflict (key) do update
    set count = usage.count + 1;
end;
$function$;

-- Atomically reserve one scan from a finite daily allowance.  The row lock
-- taken by ON CONFLICT serializes concurrent requests for the same key.
-- Returns scans remaining after the reservation, or -1 when no slot exists.
create or replace function public.consume_usage(
  usage_key text,
  usage_limit integer
)
returns integer
language plpgsql
set search_path = ''
as $function$
declare
  consumed_count integer;
begin
  if usage_key is null or char_length(btrim(usage_key)) = 0 then
    raise exception 'usage_key must not be empty';
  end if;
  if usage_limit is null or usage_limit <= 0 then
    raise exception 'usage_limit must be greater than zero';
  end if;

  insert into public.daily_usage as usage (key, count)
  values (usage_key, 1)
  on conflict (key) do update
    set count = usage.count + 1
    where usage.count < usage_limit
  returning usage.count into consumed_count;

  if consumed_count is null then
    return -1;
  end if;

  return greatest(usage_limit - consumed_count, 0);
end;
$function$;

-- Undo one successful reservation after a scan fails.  The count can never
-- become negative, and refunding a missing/already-zero key is a safe no-op.
-- Returns the counter value after the attempted refund.
create or replace function public.refund_usage(usage_key text)
returns integer
language plpgsql
set search_path = ''
as $function$
declare
  refunded_count integer;
begin
  if usage_key is null or char_length(btrim(usage_key)) = 0 then
    raise exception 'usage_key must not be empty';
  end if;

  update public.daily_usage as usage
  set count = usage.count - 1
  where usage.key = usage_key
    and usage.count > 0
  returning usage.count into refunded_count;

  return coalesce(refunded_count, 0);
end;
$function$;

-- Atomically reserve several quota counters. Advisory transaction locks make
-- the preflight and increments safe even when a counter row does not exist
-- yet. If any allowance is exhausted, no counter is changed.
create or replace function public.consume_usage_batch(
  usage_keys text[],
  usage_limits integer[]
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  item record;
  current_count integer;
begin
  if coalesce(array_length(usage_keys, 1), 0) = 0
     or array_length(usage_keys, 1) is distinct from array_length(usage_limits, 1) then
    raise exception 'usage keys and limits must be non-empty arrays of equal length';
  end if;

  for item in
    select key, limit_value
    from unnest(usage_keys, usage_limits) as requested(key, limit_value)
    order by key
  loop
    if item.key is null or char_length(btrim(item.key)) = 0
       or item.limit_value is null or item.limit_value <= 0 then
      raise exception 'invalid usage reservation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(item.key, 0));
  end loop;

  for item in
    select key, limit_value
    from unnest(usage_keys, usage_limits) as requested(key, limit_value)
  loop
    select usage.count into current_count
    from public.daily_usage as usage
    where usage.key = item.key;
    if coalesce(current_count, 0) >= item.limit_value then
      return jsonb_build_object('allowed', false, 'denied_key', item.key);
    end if;
  end loop;

  for item in
    select key, limit_value
    from unnest(usage_keys, usage_limits) as requested(key, limit_value)
  loop
    insert into public.daily_usage as usage (key, count)
    values (item.key, 1)
    on conflict (key) do update set count = usage.count + 1;
  end loop;

  return jsonb_build_object('allowed', true, 'denied_key', null);
end;
$function$;


-- Domain ownership verification -----------------------------------------

create table if not exists public.verification_tokens (
  id          bigint generated by default as identity primary key,
  domain      text not null,
  token       text not null,
  user_id     text,
  verified    boolean not null default false,
  verified_at bigint,
  verification_method text,
  created_at  bigint not null,
  constraint verification_tokens_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade,
  constraint verification_tokens_domain_check
    check (
      char_length(btrim(domain)) > 0
      and domain = lower(btrim(domain))
    ),
  constraint verification_tokens_token_check
    check (char_length(btrim(token)) > 0),
  constraint verification_tokens_created_at_check
    check (created_at >= 0)
);

-- The original schema used domain as its primary key.  That prevents the
-- ownership-transfer flow, which intentionally issues one token per
-- (domain, user).  Add a surrogate key before removing that legacy key.
alter table public.verification_tokens
  add column if not exists id bigint generated by default as identity,
  add column if not exists user_id text,
  add column if not exists verified boolean not null default false,
  add column if not exists verified_at bigint,
  add column if not exists verification_method text;

alter table public.verification_tokens
  alter column verified set default false;

do $migration$
declare
  legacy_primary_key text;
begin
  select c.conname
    into legacy_primary_key
  from pg_catalog.pg_constraint as c
  join pg_catalog.pg_attribute as a
    on a.attrelid = c.conrelid
   and a.attnum = c.conkey[1]
  where c.conrelid = 'public.verification_tokens'::regclass
    and c.contype = 'p'
    and array_length(c.conkey, 1) = 1
    and a.attname = 'domain'
  limit 1;

  if legacy_primary_key is not null then
    execute format(
      'alter table public.verification_tokens drop constraint %I',
      legacy_primary_key
    );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.verification_tokens'::regclass
      and contype = 'p'
  ) then
    alter table public.verification_tokens
      add constraint verification_tokens_pkey primary key (id);
  end if;
end;
$migration$;

-- Pending legacy rows have user_id IS NULL.  Claimed rows are unique per
-- account, and only one account may be the current verified owner.
create unique index if not exists verification_tokens_domain_user_key
  on public.verification_tokens (domain, user_id)
  where user_id is not null;
create unique index if not exists verification_tokens_legacy_domain_key
  on public.verification_tokens (domain)
  where user_id is null;
create unique index if not exists verification_tokens_verified_domain_key
  on public.verification_tokens (domain)
  where verified = true;
create unique index if not exists verification_tokens_token_key
  on public.verification_tokens (token);

-- Complete an ownership claim as one database statement. This prevents a
-- failed second write from leaving a domain unclaimed during transfer.
create or replace function public.complete_domain_verification(
  claim_domain text,
  claimant_user_id text,
  claimant_token text,
  verification_method text,
  verified_timestamp bigint
)
returns boolean
language plpgsql
set search_path = ''
as $function$
begin
  perform 1
  from public.verification_tokens as candidate
  where candidate.domain = $1
  for update;

  if not exists (
    select 1
    from public.verification_tokens as candidate
    where candidate.domain = $1
      and candidate.user_id = $2
      and candidate.token = $3
  ) then
    return false;
  end if;

  update public.verification_tokens as previous_claim
  set verified = false,
      verified_at = null,
      verification_method = null
  where previous_claim.domain = $1
    and previous_claim.user_id is distinct from $2
    and previous_claim.verified = true;

  update public.verification_tokens as current_claim
  set verified = true,
      verified_at = $5,
      verification_method = $4
  where current_claim.domain = $1
    and current_claim.user_id = $2
    and current_claim.token = $3;

  return true;
end;
$function$;

-- Append-only proof events preserve which control check authorised a scan,
-- even after a domain is transferred or the live token row is removed.
create table if not exists public.verification_events (
  id bigint generated by default as identity primary key,
  verification_id bigint references public.verification_tokens(id) on delete set null,
  domain text not null,
  user_id text references public.users(id) on delete set null,
  method text not null,
  proof_subject text,
  verified_at bigint not null,
  constraint verification_events_domain_check check (
    char_length(btrim(domain)) > 0 and domain = lower(btrim(domain))
  ),
  constraint verification_events_verified_at_check check (verified_at >= 0)
);

create index if not exists verification_events_lookup_idx
  on public.verification_events (domain, user_id, verified_at desc);

create or replace function public.complete_domain_verification_with_event(
  claim_domain text,
  claimant_user_id text,
  claimant_token text,
  verification_method text,
  verified_timestamp bigint,
  proof_subject text
)
returns bigint
language plpgsql
set search_path = ''
as $function$
declare
  verification_row_id bigint;
  event_id bigint;
begin
  perform 1
  from public.verification_tokens as candidate
  where candidate.domain = $1
  for update;

  select candidate.id into verification_row_id
  from public.verification_tokens as candidate
  where candidate.domain = $1
    and candidate.user_id = $2
    and candidate.token = $3;
  if verification_row_id is null then return null; end if;

  update public.verification_tokens as previous_claim
  set verified = false,
      verified_at = null,
      verification_method = null
  where previous_claim.domain = $1
    and previous_claim.user_id is distinct from $2
    and previous_claim.verified = true;

  update public.verification_tokens as current_claim
  set verified = true,
      verified_at = $5,
      verification_method = $4
  where current_claim.id = verification_row_id;

  insert into public.verification_events (
    verification_id, domain, user_id, method, proof_subject, verified_at
  ) values (
    verification_row_id, $1, $2, $4, $6, $5
  ) returning id into event_id;

  return event_id;
end;
$function$;

-- OAuth credentials are encrypted by the application before storage. Only
-- the service-role backend reads this table; no browser policy is granted.
create table if not exists public.verification_provider_connections (
  id bigint generated by default as identity primary key,
  user_id text not null references public.users(id) on delete cascade,
  provider text not null,
  provider_account_id text,
  access_token_encrypted text not null,
  updated_at bigint not null,
  constraint verification_provider_name_check check (provider in ('vercel', 'netlify')),
  constraint verification_provider_token_check check (char_length(access_token_encrypted) > 20),
  unique (user_id, provider)
);


-- Active/deep scans -------------------------------------------------------

create table if not exists public.deep_scans (
  id          text primary key,
  domain      text not null,
  user_id     text not null,
  result      jsonb not null,
  authorization_terms_version text,
  authorization_accepted_at bigint,
  created_at  bigint not null,
  constraint deep_scans_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade,
  constraint deep_scans_domain_check
    check (char_length(btrim(domain)) > 0 and domain = lower(btrim(domain))),
  constraint deep_scans_result_object_check
    check (jsonb_typeof(result) = 'object'),
  constraint deep_scans_created_at_check
    check (created_at >= 0)
);

alter table public.deep_scans
  add column if not exists authorization_terms_version text,
  add column if not exists authorization_accepted_at bigint,
  add column if not exists verification_snapshot jsonb;

create index if not exists deep_scans_user_created_idx
  on public.deep_scans (user_id, created_at desc);
create index if not exists deep_scans_domain_created_idx
  on public.deep_scans (domain, created_at desc);

-- Ironclad lane model ------------------------------------------------------
-- deep_scans becomes the single store for both lanes. Existing rows are deep
-- scans, which is what the default records. user_id becomes nullable so an
-- anonymous surface scan can be held until its owner signs up and claims it.

alter table public.deep_scans
  add column if not exists lane             text not null default 'deep',
  add column if not exists claim_token      text,
  add column if not exists claim_expires_at bigint;

alter table public.deep_scans
  alter column user_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'deep_scans_lane_check'
  ) then
    alter table public.deep_scans
      add constraint deep_scans_lane_check check (lane in ('surface', 'deep'));
  end if;

  -- An anonymous deep scan must be impossible, not merely unwritten. Deep
  -- checks send payloads and require domain-control evidence tied to an
  -- account, so a row with no owner can only ever be a surface scan.
  if not exists (
    select 1 from pg_constraint where conname = 'deep_scans_anonymous_surface_only_check'
  ) then
    alter table public.deep_scans
      add constraint deep_scans_anonymous_surface_only_check
      check (user_id is not null or lane = 'surface');
  end if;

  -- A claim token without an expiry would never be purged.
  if not exists (
    select 1 from pg_constraint where conname = 'deep_scans_claim_expiry_check'
  ) then
    alter table public.deep_scans
      add constraint deep_scans_claim_expiry_check
      check (claim_token is null or claim_expires_at is not null);
  end if;
end $$;

create unique index if not exists deep_scans_claim_token_idx
  on public.deep_scans (claim_token) where claim_token is not null;

create index if not exists deep_scans_unclaimed_idx
  on public.deep_scans (claim_expires_at) where user_id is null;

-- Seed the atomic lifetime allowance ledger from existing completed scans.
-- Re-running this migration never reduces a counter that already includes a
-- concurrent reservation or a scan recorded after the seed query.
-- Anonymous rows are excluded: they belong to no account, and grouping them
-- would build a key from a null user id.
insert into public.daily_usage as usage (key, count)
select
  'deep:' || user_id || ':lifetime',
  count(*)::integer
from public.deep_scans
where user_id is not null
group by user_id
on conflict (key) do update
set count = greatest(usage.count, excluded.count);


-- Comments and likes ------------------------------------------------------

create table if not exists public.comments (
  id          text primary key,
  scan_id     text not null,
  user_id     text not null,
  user_name   text not null,
  body        text not null,
  parent_id   text,
  created_at  bigint not null,
  edited_at   bigint,
  constraint comments_id_scan_key unique (id, scan_id),
  constraint comments_scan_id_fkey
    foreign key (scan_id) references public.scans(id) on delete cascade,
  constraint comments_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade,
  constraint comments_parent_same_scan_fkey
    foreign key (parent_id, scan_id)
    references public.comments(id, scan_id) on delete cascade,
  constraint comments_user_name_length_check
    check (char_length(btrim(user_name)) between 1 and 40),
  constraint comments_body_length_check
    check (char_length(btrim(body)) between 1 and 500),
  constraint comments_created_at_check
    check (created_at >= 0),
  constraint comments_edited_at_check
    check (edited_at is null or edited_at >= created_at)
);

alter table public.comments
  add column if not exists parent_id text,
  add column if not exists edited_at bigint;

create unique index if not exists comments_id_scan_key
  on public.comments (id, scan_id);
create index if not exists comments_scan_created_idx
  on public.comments (scan_id, created_at);
create index if not exists comments_user_created_idx
  on public.comments (user_id, created_at desc);
create index if not exists comments_parent_idx
  on public.comments (parent_id)
  where parent_id is not null;

create table if not exists public.comment_likes (
  comment_id  text not null,
  user_id     text not null,
  primary key (comment_id, user_id),
  constraint comment_likes_comment_id_fkey
    foreign key (comment_id) references public.comments(id) on delete cascade,
  constraint comment_likes_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade
);

create index if not exists comment_likes_user_idx
  on public.comment_likes (user_id);

create table if not exists public.scan_likes (
  scan_id  text not null,
  user_id  text not null,
  primary key (scan_id, user_id),
  constraint scan_likes_scan_id_fkey
    foreign key (scan_id) references public.scans(id) on delete cascade,
  constraint scan_likes_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade
);

create index if not exists scan_likes_user_idx
  on public.scan_likes (user_id);


-- In-app notifications ----------------------------------------------------

create table if not exists public.notifications (
  id           text primary key,
  user_id      text not null,
  type         text not null,
  title        text not null,
  description  text not null,
  link         text,
  read         boolean not null default false,
  created_at   bigint not null,
  constraint notifications_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade,
  constraint notifications_type_check
    check (type in ('comment', 'reply', 'popular', 'security', 'system')),
  constraint notifications_title_check
    check (char_length(btrim(title)) > 0),
  constraint notifications_description_check
    check (char_length(btrim(description)) > 0),
  constraint notifications_created_at_check
    check (created_at >= 0)
);

alter table public.notifications
  add column if not exists link text,
  add column if not exists read boolean not null default false;

alter table public.notifications
  alter column read set default false;

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read = false;


-- False-positive feedback -------------------------------------------------

create table if not exists public.false_positive_reports (
  id           bigint generated by default as identity primary key,
  site         text not null,
  issue_id     text not null,
  issue_title  text not null default '',
  comment      text not null default '',
  created_at   bigint not null,
  constraint false_positive_reports_site_check
    check (char_length(btrim(site)) > 0),
  constraint false_positive_reports_issue_id_check
    check (char_length(btrim(issue_id)) > 0),
  constraint false_positive_reports_created_at_check
    check (created_at >= 0)
);

alter table public.false_positive_reports
  add column if not exists id bigint generated by default as identity,
  add column if not exists issue_title text not null default '',
  add column if not exists comment text not null default '';

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.false_positive_reports'::regclass
      and contype = 'p'
  ) then
    alter table public.false_positive_reports
      add constraint false_positive_reports_pkey primary key (id);
  end if;
end;
$migration$;

create index if not exists false_positive_reports_created_idx
  on public.false_positive_reports (created_at desc);
create index if not exists false_positive_reports_issue_idx
  on public.false_positive_reports (issue_id, created_at desc);


-- Leaderboard rank snapshots ---------------------------------------------

create table if not exists public.rank_snapshots (
  domain         text not null,
  category       text not null,
  time_filter    text not null,
  scoring_version text not null default 'legacy',
  rank_position  integer not null,
  score          integer not null,
  snapshot_date  date not null default current_date,
  primary key (domain, category, time_filter, scoring_version, snapshot_date),
  constraint rank_snapshots_domain_check
    check (char_length(btrim(domain)) > 0),
  constraint rank_snapshots_category_check
    check (category in ('vibe', 'secure')),
  constraint rank_snapshots_time_filter_check
    check (time_filter in ('today', 'week', 'all')),
  constraint rank_snapshots_rank_position_check
    check (rank_position > 0),
  constraint rank_snapshots_score_check
    check (score between 0 and 100)
);

alter table public.rank_snapshots
  add column if not exists scoring_version text not null default 'legacy',
  alter column snapshot_date set default current_date;

do $migration$
declare
  primary_key_name text;
  primary_key_definition text;
begin
  select constraint_row.conname, pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into primary_key_name, primary_key_definition
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.rank_snapshots'::regclass
    and constraint_row.contype = 'p'
  limit 1;

  if primary_key_name is not null
     and position('scoring_version' in primary_key_definition) = 0 then
    execute format('alter table public.rank_snapshots drop constraint %I', primary_key_name);
    primary_key_name := null;
  end if;

  if primary_key_name is null then
    alter table public.rank_snapshots
      add constraint rank_snapshots_pkey
      primary key (domain, category, time_filter, scoring_version, snapshot_date);
  end if;
end;
$migration$;

create index if not exists rank_snapshots_date_idx
  on public.rank_snapshots (snapshot_date desc);
drop index if exists public.rank_snapshots_top_streak_idx;
create index if not exists rank_snapshots_top_streak_idx
  on public.rank_snapshots (domain, scoring_version, rank_position, snapshot_date desc);


-- Constraints needed when upgrading the original partial schema ----------
-- NOT VALID keeps the migration safe if historical rows predate a rule;
-- PostgreSQL still enforces each constraint for all new writes.

do $migration$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_plan_check'
  ) then
    alter table public.users add constraint users_plan_check
      check (plan in ('free', 'pro', 'team')) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_name_length_check'
  ) then
    alter table public.users add constraint users_name_length_check
      check (char_length(btrim(name)) between 1 and 40) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_email_normalized_check'
  ) then
    alter table public.users add constraint users_email_normalized_check
      check (email = lower(btrim(email)) and char_length(email) > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_bio_length_check'
  ) then
    alter table public.users add constraint users_bio_length_check
      check (bio is null or char_length(bio) <= 200) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_avatar_url_length_check'
  ) then
    alter table public.users add constraint users_avatar_url_length_check
      check (avatar_url is null or char_length(avatar_url) <= 600000) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_password_hash_check'
  ) then
    alter table public.users add constraint users_password_hash_check
      check (char_length(password_hash) > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_created_at_check'
  ) then
    alter table public.users add constraint users_created_at_check
      check (created_at >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.scans'::regclass
      and conname = 'scans_user_id_fkey'
  ) then
    alter table public.scans add constraint scans_user_id_fkey
      foreign key (user_id) references public.users(id)
      on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.scans'::regclass
      and conname = 'scans_result_object_check'
  ) then
    alter table public.scans add constraint scans_result_object_check
      check (jsonb_typeof(result) = 'object') not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.scans'::regclass
      and conname = 'scans_roasts_array_check'
  ) then
    alter table public.scans add constraint scans_roasts_array_check
      check (jsonb_typeof(roasts) = 'array') not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.scans'::regclass
      and conname = 'scans_created_at_check'
  ) then
    alter table public.scans add constraint scans_created_at_check
      check (created_at >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.daily_usage'::regclass
      and conname = 'daily_usage_key_check'
  ) then
    alter table public.daily_usage add constraint daily_usage_key_check
      check (char_length(btrim(key)) > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.daily_usage'::regclass
      and conname = 'daily_usage_count_check'
  ) then
    alter table public.daily_usage add constraint daily_usage_count_check
      check (count >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.verification_tokens'::regclass
      and conname = 'verification_tokens_user_id_fkey'
  ) then
    alter table public.verification_tokens
      add constraint verification_tokens_user_id_fkey
      foreign key (user_id) references public.users(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.verification_tokens'::regclass
      and conname = 'verification_tokens_domain_check'
  ) then
    alter table public.verification_tokens
      add constraint verification_tokens_domain_check
      check (
        char_length(btrim(domain)) > 0
        and domain = lower(btrim(domain))
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.verification_tokens'::regclass
      and conname = 'verification_tokens_token_check'
  ) then
    alter table public.verification_tokens
      add constraint verification_tokens_token_check
      check (char_length(btrim(token)) > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.verification_tokens'::regclass
      and conname = 'verification_tokens_created_at_check'
  ) then
    alter table public.verification_tokens
      add constraint verification_tokens_created_at_check
      check (created_at >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deep_scans'::regclass
      and conname = 'deep_scans_user_id_fkey'
  ) then
    alter table public.deep_scans add constraint deep_scans_user_id_fkey
      foreign key (user_id) references public.users(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deep_scans'::regclass
      and conname = 'deep_scans_domain_check'
  ) then
    alter table public.deep_scans add constraint deep_scans_domain_check
      check (
        char_length(btrim(domain)) > 0
        and domain = lower(btrim(domain))
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deep_scans'::regclass
      and conname = 'deep_scans_result_object_check'
  ) then
    alter table public.deep_scans add constraint deep_scans_result_object_check
      check (jsonb_typeof(result) = 'object') not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deep_scans'::regclass
      and conname = 'deep_scans_created_at_check'
  ) then
    alter table public.deep_scans add constraint deep_scans_created_at_check
      check (created_at >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.rank_snapshots'::regclass
      and conname = 'rank_snapshots_domain_check'
  ) then
    alter table public.rank_snapshots add constraint rank_snapshots_domain_check
      check (char_length(btrim(domain)) > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.rank_snapshots'::regclass
      and conname = 'rank_snapshots_category_check'
  ) then
    alter table public.rank_snapshots add constraint rank_snapshots_category_check
      check (category in ('vibe', 'secure')) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.rank_snapshots'::regclass
      and conname = 'rank_snapshots_time_filter_check'
  ) then
    alter table public.rank_snapshots add constraint rank_snapshots_time_filter_check
      check (time_filter in ('today', 'week', 'all')) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.rank_snapshots'::regclass
      and conname = 'rank_snapshots_rank_position_check'
  ) then
    alter table public.rank_snapshots
      add constraint rank_snapshots_rank_position_check
      check (rank_position > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.rank_snapshots'::regclass
      and conname = 'rank_snapshots_score_check'
  ) then
    alter table public.rank_snapshots add constraint rank_snapshots_score_check
      check (score between 0 and 100) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.comments'::regclass
      and conname = 'comments_parent_same_scan_fkey'
  ) then
    alter table public.comments
      add constraint comments_parent_same_scan_fkey
      foreign key (parent_id, scan_id)
      references public.comments(id, scan_id)
      on delete cascade not valid;
  end if;
end;
$migration$;


-- Security ---------------------------------------------------------------
-- All database access in the current app uses SUPABASE_SERVICE_ROLE_KEY on
-- the server.  Enabling RLS with no client policies keeps anon/authenticated
-- Supabase keys from reading password hashes or mutating application data;
-- service_role continues to bypass RLS.

alter table public.users enable row level security;
alter table public.scans enable row level security;
alter table public.daily_usage enable row level security;
alter table public.verification_tokens enable row level security;
alter table public.verification_events enable row level security;
alter table public.verification_provider_connections enable row level security;
alter table public.deep_scans enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.scan_likes enable row level security;
alter table public.notifications enable row level security;
alter table public.false_positive_reports enable row level security;
alter table public.rank_snapshots enable row level security;

-- community_posts and community_reactions belonged to an abandoned feed
-- model.  Do not recreate them on fresh installs and do not drop them during
-- upgrades (they may contain user data).  If they remain, lock them down too.
do $migration$
begin
  if to_regclass('public.community_posts') is not null then
    alter table public.community_posts enable row level security;
  end if;
  if to_regclass('public.community_reactions') is not null then
    alter table public.community_reactions enable row level security;
  end if;
end;
$migration$;

-- Legacy tables ------------------------------------------------------------
-- Left in place rather than dropped: no destructive migration. `scans` held
-- results from the retired passive scanner, which wrote a format nothing
-- produces any more, and whose model versions must not be compared against
-- current ones. `comments` and `likes` served the public feed, removed
-- because a ranked list of sites with exposed secrets is a shopping list for
-- attackers.
do $legacy$
begin
  if to_regclass('public.scans') is not null then
    comment on table public.scans is 'Legacy. Retired passive scanner. Read by nothing.';
  end if;
  if to_regclass('public.comments') is not null then
    comment on table public.comments is 'Legacy. Public feed removed in the Ironclad repositioning.';
  end if;
  if to_regclass('public.scan_likes') is not null then
    comment on table public.scan_likes is 'Legacy. Public feed removed in the Ironclad repositioning.';
  end if;
  if to_regclass('public.comment_likes') is not null then
    comment on table public.comment_likes is 'Legacy. Public feed removed in the Ironclad repositioning.';
  end if;
end;
$legacy$;

commit;
