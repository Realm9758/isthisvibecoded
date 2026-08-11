import test from 'node:test';
import assert from 'node:assert/strict';
import { diffScans } from '../lib/scan-diff';
import type { DeepScanResult, DeepFinding } from '../types/deep-scan';
import type { ScanLane } from '../lib/scan-lanes';

function finding(id: string, url?: string): DeepFinding {
  return {
    id,
    category: 'headers',
    severity: 'medium',
    title: id,
    description: '',
    remediation: '',
    url,
  };
}

function scan(lane: ScanLane | undefined, findings: DeepFinding[]): DeepScanResult {
  return {
    domain: 'example.com',
    lane,
    scannedAt: '2026-08-11T00:00:00.000Z',
    duration: 1,
    summary: { critical: 0, high: 0, medium: findings.length, low: 0, info: 0, score: 70 },
    findings,
    checked: [],
  };
}

test('classifies resolved, added, and still-open findings', () => {
  const diff = diffScans(
    scan('surface', [finding('a'), finding('b')]),
    scan('surface', [finding('b'), finding('c')]),
  );
  assert.deepEqual(diff.resolved.map(f => f.id), ['a']);
  assert.deepEqual(diff.added.map(f => f.id), ['c']);
  assert.deepEqual(diff.stillOpen.map(f => f.id), ['b']);
  assert.equal(diff.comparable, true);
});

test('the same rule id at a different url is a different finding', () => {
  const diff = diffScans(
    scan('surface', [finding('cookie-secure', 'https://example.com/a')]),
    scan('surface', [finding('cookie-secure', 'https://example.com/b')]),
  );
  assert.equal(diff.resolved.length, 1);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.stillOpen.length, 0);
});

test('scans from different lanes are never compared', () => {
  const diff = diffScans(scan('surface', [finding('a')]), scan('deep', [finding('a')]));
  assert.equal(diff.comparable, false);
  assert.deepEqual(diff.resolved, []);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.stillOpen, []);
});

test('a legacy row with no lane counts as a deep scan', () => {
  const againstDeep = diffScans(scan(undefined, [finding('a')]), scan('deep', [finding('a')]));
  assert.equal(againstDeep.comparable, true);
  assert.deepEqual(againstDeep.stillOpen.map(f => f.id), ['a']);

  const againstSurface = diffScans(scan(undefined, [finding('a')]), scan('surface', [finding('a')]));
  assert.equal(againstSurface.comparable, false);
});

test('a first scan has nothing to compare against', () => {
  const diff = diffScans(null, scan('surface', [finding('a')]));
  assert.equal(diff.comparable, false);
  assert.deepEqual(diff.added, []);
});

test('a clean rescan of a previously failing site reports everything resolved', () => {
  const diff = diffScans(
    scan('surface', [finding('a'), finding('b')]),
    scan('surface', []),
  );
  assert.deepEqual(diff.resolved.map(f => f.id), ['a', 'b']);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.stillOpen, []);
});

test('an unchanged rescan reports no movement in either direction', () => {
  const diff = diffScans(
    scan('surface', [finding('a'), finding('b')]),
    scan('surface', [finding('a'), finding('b')]),
  );
  assert.deepEqual(diff.resolved, []);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.stillOpen.map(f => f.id), ['a', 'b']);
});
