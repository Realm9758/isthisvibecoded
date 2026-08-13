import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeScanCheckpoints, encodeScanCheckpoints } from '../lib/scan-checkpoint';
import type { ScanPhaseCheckpoint } from '../types/deep-scan';

const checkpoint: ScanPhaseCheckpoint = {
  phaseId: 'headers',
  findings: [],
  coverage: {
    phaseId: 'headers', requestsAttempted: 2, requestsCompleted: 2,
    requestsFailed: 0, requestsBlocked: 0, durationMs: 140,
    applicable: true, complete: true, reason: null,
  },
  transportAttempts: 3,
  retries: 1,
};

test('private module checkpoints round-trip and keep the latest phase record', () => {
  const replacement = { ...checkpoint, transportAttempts: 4 };
  const decoded = decodeScanCheckpoints(encodeScanCheckpoints([checkpoint, replacement]));
  assert.deepEqual(decoded, [replacement]);
});

test('malformed or mismatched checkpoints fail closed', () => {
  assert.deepEqual(decodeScanCheckpoints('not-json'), []);
  const mismatched = {
    ...checkpoint,
    coverage: { ...checkpoint.coverage, phaseId: 'ssl' },
  };
  const envelope = JSON.stringify({
    format: 'ironclad-phase-checkpoint-v1',
    data: Buffer.from(JSON.stringify([mismatched])).toString('base64url'),
  });
  assert.deepEqual(decodeScanCheckpoints(envelope), []);
});
