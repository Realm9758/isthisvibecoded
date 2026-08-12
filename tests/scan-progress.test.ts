import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveScanPhaseOutcome,
  type ScanPhaseRequestCoverage,
} from '../lib/scan-progress';

function coverage(
  over: Partial<ScanPhaseRequestCoverage> = {},
): ScanPhaseRequestCoverage {
  return {
    requestsAttempted: 1,
    requestsCompleted: 1,
    requestsFailed: 0,
    requestsBlocked: 0,
    ...over,
  };
}

test('a fully covered applicable phase is complete', () => {
  const requestCoverage = coverage({ requestsAttempted: 3, requestsCompleted: 3 });

  assert.deepEqual(resolveScanPhaseOutcome({ coverage: requestCoverage }), {
    status: 'complete',
    coverage: requestCoverage,
    reason: null,
  });
});

test('a local phase can complete without issuing another request', () => {
  assert.equal(resolveScanPhaseOutcome({
    coverage: coverage({ requestsAttempted: 0, requestsCompleted: 0 }),
  }).status, 'complete');
});

test('non-applicable takes precedence and has a useful default reason', () => {
  const outcome = resolveScanPhaseOutcome({
    applicable: false,
    coverage: coverage({
      requestsAttempted: 2,
      requestsCompleted: 0,
      requestsFailed: 1,
      requestsBlocked: 1,
    }),
  });

  assert.equal(outcome.status, 'not_applicable');
  assert.equal(outcome.reason, 'Not applicable');
});

test('a non-applicable phase preserves a specific explanation', () => {
  const outcome = resolveScanPhaseOutcome({
    applicable: false,
    coverage: coverage({ requestsAttempted: 0, requestsCompleted: 0 }),
    reason: 'No Supabase project was discovered',
  });

  assert.equal(outcome.status, 'not_applicable');
  assert.equal(outcome.reason, 'No Supabase project was discovered');
});

test('an explicit problem makes clean request accounting inconclusive', () => {
  const outcome = resolveScanPhaseOutcome({
    coverage: coverage(),
    reason: 'The response could not be parsed safely',
  });

  assert.equal(outcome.status, 'incomplete');
  assert.equal(outcome.reason, 'The response could not be parsed safely');
});

test('blocked and failed requests cannot be reported as complete', () => {
  const blocked = resolveScanPhaseOutcome({
    coverage: coverage({ requestsBlocked: 1 }),
  });
  const failed = resolveScanPhaseOutcome({
    coverage: coverage({ requestsFailed: 1 }),
  });

  assert.deepEqual(
    { status: blocked.status, reason: blocked.reason },
    { status: 'incomplete', reason: 'One or more requests were blocked before they could be evaluated' },
  );
  assert.deepEqual(
    { status: failed.status, reason: failed.reason },
    { status: 'incomplete', reason: 'The request failed or timed out' },
  );
});

test('blocked coverage reason takes priority when failures also occurred', () => {
  const outcome = resolveScanPhaseOutcome({
    coverage: coverage({ requestsBlocked: 1, requestsFailed: 2 }),
  });

  assert.equal(outcome.status, 'incomplete');
  assert.equal(outcome.reason, 'One or more requests were blocked before they could be evaluated');
});

test('an unaccounted attempted request is incomplete even without a failure counter', () => {
  const outcome = resolveScanPhaseOutcome({
    coverage: coverage({
      requestsAttempted: 4,
      requestsCompleted: 3,
    }),
  });

  assert.equal(outcome.status, 'incomplete');
  assert.equal(outcome.reason, 'Not every attempted request completed');
});

test('blank explicit reasons do not turn a covered phase incomplete', () => {
  const outcome = resolveScanPhaseOutcome({ coverage: coverage(), reason: '   ' });

  assert.equal(outcome.status, 'complete');
  assert.equal(outcome.reason, null);
});
