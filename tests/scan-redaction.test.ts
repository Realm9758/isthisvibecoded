import test from 'node:test';
import assert from 'node:assert/strict';
import { redactForAnonymous } from '../lib/scan-redaction';
import type { DeepScanResult } from '../types/deep-scan';

const FULL: DeepScanResult = {
  domain: 'example.com',
  lane: 'surface',
  scannedAt: '2026-08-11T00:00:00.000Z',
  duration: 1234,
  versions: { scanner: 's', scoring: 'g', coverage: 'c', lane: 'surface' },
  summary: { critical: 1, high: 0, medium: 2, low: 0, info: 0, score: 22 },
  coverage: {
    requestsAttempted: 40,
    requestsCompleted: 39,
    requestsFailed: 1,
    requestsBlocked: 0,
    complete: false,
    checks: [{
      phaseId: 'files',
      requestsAttempted: 25,
      requestsCompleted: 24,
      requestsFailed: 1,
      requestsBlocked: 0,
      complete: false,
      reason: 'The request failed or timed out',
    }],
  },
  findings: [{
    id: 'exposed-env',
    category: 'exposed-files',
    severity: 'critical',
    title: 'Environment File Exposed',
    description: 'The .env file is publicly accessible.',
    evidence: 'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...',
    remediation: 'Block access to .env files.',
    url: 'https://example.com/.env',
  }],
  checked: [{
    id: 'files',
    label: 'Sensitive File Exposure',
    description: '.env, .git, wp-config.php',
    status: 'fail',
    detail: 'Environment File Exposed at https://example.com/.env',
  }],
};

test('the persuasive fields never reach the wire', () => {
  const serialised = JSON.stringify(redactForAnonymous(FULL));
  for (const secret of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'Block access to .env',
    'publicly accessible',
    '/.env',
  ]) {
    assert.equal(serialised.includes(secret), false, `leaked: ${secret}`);
  }
});

test('no finding retains description, evidence, remediation, or url', () => {
  for (const finding of redactForAnonymous(FULL).findings) {
    assert.equal('description' in finding, false);
    assert.equal('evidence' in finding, false);
    assert.equal('remediation' in finding, false);
    assert.equal('url' in finding, false);
  }
});

test('no checked item retains its site-specific detail', () => {
  for (const item of redactForAnonymous(FULL).checked) {
    assert.equal('detail' in item, false);
  }
});

test('the counts, grade, and coverage survive so the reader sees a problem exists', () => {
  const redacted = redactForAnonymous(FULL);
  assert.deepEqual(redacted.summary, FULL.summary);
  assert.equal(redacted.coverage?.complete, false);
  assert.equal(redacted.findings[0].title, 'Environment File Exposed');
  assert.equal(redacted.findings[0].severity, 'critical');
  assert.equal(redacted.checked[0].status, 'fail');
  assert.equal(redacted.redacted, true);
});

test('a withheld grade stays withheld rather than becoming a number', () => {
  const withheld = { ...FULL, summary: { ...FULL.summary, score: null } };
  assert.equal(redactForAnonymous(withheld).summary.score, null);
});

test('an empty scan redacts without throwing', () => {
  const empty = { ...FULL, findings: [], checked: [] };
  assert.deepEqual(redactForAnonymous(empty).findings, []);
  assert.deepEqual(redactForAnonymous(empty).checked, []);
});

test('redaction does not mutate the caller"s result', () => {
  redactForAnonymous(FULL);
  assert.equal(FULL.findings[0].evidence, 'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...');
  assert.equal(FULL.checked[0].detail, 'Environment File Exposed at https://example.com/.env');
});
