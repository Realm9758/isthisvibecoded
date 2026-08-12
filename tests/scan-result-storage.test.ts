import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeScanResultFromStorage,
  encodeScanResultForStorage,
  summarizeScanStorageError,
} from '../lib/scan-result-storage';
import type { DeepScanResult } from '../types/deep-scan';

const RESULT: DeepScanResult = {
  domain: 'example.com',
  lane: 'deep',
  scannedAt: '2026-08-12T12:00:00.000Z',
  duration: 100,
  summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0, score: 0 },
  findings: [{
    id: 'traversal',
    category: 'injection',
    severity: 'critical',
    title: 'Traversal evidence',
    description: 'The crafted input returned ../../../etc/passwd and root:x:0:0',
    evidence: "id=1' OR '1'='1 and <script>alert(1)</script>",
    remediation: 'Validate input.',
  }],
  checked: [],
};

test('scan storage round-trips reports without sending exploit-like text in plain JSON', () => {
  const stored = encodeScanResultForStorage(RESULT);
  const wire = JSON.stringify(stored);
  assert.doesNotMatch(wire, /etc\/passwd|script|OR '1'/i);
  assert.deepEqual(decodeScanResultFromStorage(stored), RESULT);
});

test('legacy plain JSON scan rows remain readable', () => {
  assert.deepEqual(decodeScanResultFromStorage(RESULT), RESULT);
});

test('invalid storage envelopes fail closed', () => {
  assert.equal(decodeScanResultFromStorage({ format: 'ironclad-scan-base64url-json-v1', data: 'bad' }), null);
});

test('storage errors do not log an upstream HTML block page', () => {
  const summary = summarizeScanStorageError({ message: '<!DOCTYPE html><title>Attention Required! | Cloudflare</title>' });
  assert.equal(summary.reason, 'Upstream storage firewall rejected the request body');
});
