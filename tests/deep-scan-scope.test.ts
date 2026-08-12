import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEEP_SCAN_MODULES,
  DEEP_SCAN_PROFILES,
  deepScanScopeInventoryMatchesLanes,
  fullDeepScanScope,
  parseRequestedDeepScanScope,
  phasesForDeepScanScope,
  resolveDeepScanScope,
} from '../lib/deep-scan-scope';

test('scope catalogue accounts for every scanner module exactly once', () => {
  assert.equal(deepScanScopeInventoryMatchesLanes(), true);
  assert.equal(new Set(DEEP_SCAN_MODULES.map(module => module.id)).size, DEEP_SCAN_MODULES.length);
  assert.equal(fullDeepScanScope().length, DEEP_SCAN_MODULES.length);
  assert.ok(DEEP_SCAN_PROFILES.full.phaseIds.includes('ratelimit'));
});

test('input and API scopes visibly include their browser-discovery dependency', () => {
  assert.deepEqual(resolveDeepScanScope(['sqli']), ['vibe', 'sqli']);
  assert.deepEqual(resolveDeepScanScope(['headers']), ['headers']);
});

test('requested scope is validated, deduplicated and returned in scanner order', () => {
  assert.deepEqual(parseRequestedDeepScanScope(['ssl', 'headers', 'ssl']), ['headers', 'ssl']);
  assert.throws(() => parseRequestedDeepScanScope([]), /at least one/);
  assert.throws(() => parseRequestedDeepScanScope(['made-up']), /unknown module/);
  assert.throws(() => parseRequestedDeepScanScope('headers'), /at least one/);
});

test('phase manifest contains only framing and selected modules', () => {
  assert.deepEqual(
    phasesForDeepScanScope(['ssl', 'headers']).map(phase => phase.id),
    ['init', 'headers', 'ssl', 'done'],
  );
});
