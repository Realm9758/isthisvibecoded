import assert from 'node:assert/strict';
import test from 'node:test';
import { formatModuleDuration, moduleExecutionSummary, summarizeScanReceipt } from '../lib/scan-receipt';
import type { CheckCoverage } from '../types/deep-scan';

const coverage = (overrides: Partial<CheckCoverage>): CheckCoverage => ({
  phaseId: 'example',
  requestsAttempted: 0,
  requestsCompleted: 0,
  requestsFailed: 0,
  requestsBlocked: 0,
  applicable: true,
  complete: true,
  reason: null,
  ...overrides,
});

test('scan receipt separates network, local, inconclusive and not-applicable modules', () => {
  const receipt = summarizeScanReceipt([
    coverage({ phaseId: 'network', requestsAttempted: 3, requestsCompleted: 3 }),
    coverage({ phaseId: 'local' }),
    coverage({ phaseId: 'incomplete', requestsAttempted: 2, requestsCompleted: 1, requestsFailed: 1, complete: false }),
    coverage({ phaseId: 'provider', applicable: false }),
  ]);

  assert.deepEqual(receipt, {
    modules: 4,
    completedModules: 2,
    incompleteModules: 1,
    notApplicableModules: 1,
    networkModules: 2,
    localModules: 1,
  });
});

test('module execution summary exposes actual activity without inventing legacy timing', () => {
  assert.equal(moduleExecutionSummary(coverage({ requestsAttempted: 1, durationMs: 143 })), '1 HTTP probe · 143 ms');
  assert.equal(moduleExecutionSummary(coverage({ durationMs: 0 })), 'analysed downloaded page data · <1 ms');
  assert.equal(moduleExecutionSummary(coverage({ applicable: false, durationMs: 0 })), 'not applicable · <1 ms');
  assert.equal(moduleExecutionSummary(coverage({ requestsAttempted: 4 })), '4 HTTP probes');
  assert.equal(formatModuleDuration(1_240), '1.2 s');
});
