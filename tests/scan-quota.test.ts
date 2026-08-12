import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANONYMOUS_DAILY_LIMIT, FREE_LIFETIME_LIMIT, USER_BURST_LIMIT, TARGET_HOURLY_LIMIT,
  SURFACE_TARGET_HOURLY_LIMIT, anonymousDailyKey, freeLifetimeKey, userBurstKey,
  targetHourlyKey, surfaceTargetHourlyKey,
  providerTargetHourlyKey,
} from '../lib/scan-quota';

const NOW = new Date('2026-08-11T14:37:05.000Z');

test('the free lifetime allowance is three scans', () => {
  assert.equal(FREE_LIFETIME_LIMIT, 3);
});

test('anonymous callers get one scan per day', () => {
  assert.equal(ANONYMOUS_DAILY_LIMIT, 1);
  assert.equal(anonymousDailyKey('anon:abc', NOW), 'surface:anon:abc:2026-08-11');
});

test('the lifetime key keeps its legacy name so seeded counters stay valid', () => {
  assert.equal(freeLifetimeKey('user-1'), 'deep:user-1:lifetime');
});

test('burst keys are per minute and target keys are per hour', () => {
  assert.equal(USER_BURST_LIMIT, 1);
  assert.equal(userBurstKey('user-1', NOW), 'scan-burst:user-1:2026-08-11T14:37');
  assert.equal(targetHourlyKey('example.com', NOW), 'scan-target:example.com:2026-08-11T14');
});

test('the per-target cap is an abuse control shared by every caller', () => {
  assert.equal(TARGET_HOURLY_LIMIT, 10);
  assert.equal(SURFACE_TARGET_HOURLY_LIMIT, 6);
  // Case cannot be used to mint a fresh allowance against the same victim.
  assert.equal(targetHourlyKey('Example.COM', NOW), 'scan-target:example.com:2026-08-11T14');
  assert.equal(surfaceTargetHourlyKey('Example.COM', NOW), 'scan-target-surface:example.com:2026-08-11T14');
  assert.equal(providerTargetHourlyKey('Project.Supabase.CO', NOW), 'provider-target:project.supabase.co:2026-08-11T14');
});

test('keys roll over on their own boundary and not before', () => {
  const sameHour = new Date('2026-08-11T14:59:59.000Z');
  const nextHour = new Date('2026-08-11T15:00:00.000Z');
  assert.equal(targetHourlyKey('example.com', sameHour), targetHourlyKey('example.com', NOW));
  assert.notEqual(targetHourlyKey('example.com', nextHour), targetHourlyKey('example.com', NOW));

  const sameDay = new Date('2026-08-11T23:59:59.000Z');
  const nextDay = new Date('2026-08-12T00:00:00.000Z');
  assert.equal(anonymousDailyKey('anon:abc', sameDay), anonymousDailyKey('anon:abc', NOW));
  assert.notEqual(anonymousDailyKey('anon:abc', nextDay), anonymousDailyKey('anon:abc', NOW));
});

test('different callers and targets never share a key', () => {
  assert.notEqual(anonymousDailyKey('anon:a', NOW), anonymousDailyKey('anon:b', NOW));
  assert.notEqual(freeLifetimeKey('user-1'), freeLifetimeKey('user-2'));
  assert.notEqual(targetHourlyKey('a.com', NOW), targetHourlyKey('b.com', NOW));
});
