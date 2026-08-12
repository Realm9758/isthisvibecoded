import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreIsWithheld,
  describeCoverageFailure,
  incompleteChecks,
  SCORED_PHASE_IDS,
} from '../lib/scan-coverage';
import { SURFACE_PHASE_IDS, DEEP_ONLY_PHASE_IDS } from '../lib/scan-lanes';
import type { CheckCoverage } from '../types/deep-scan';

function coverage(phaseId: string, over: Partial<CheckCoverage> = {}): CheckCoverage {
  return {
    phaseId,
    requestsAttempted: 1,
    requestsCompleted: 1,
    requestsFailed: 0,
    requestsBlocked: 0,
    complete: true,
    reason: null,
    ...over,
  };
}

test('a complete scan keeps its score', () => {
  assert.equal(scoreIsWithheld([coverage('headers'), coverage('files')]), false);
});

test('a blocked scored check withholds the score', () => {
  const blocked = coverage('files', {
    requestsBlocked: 1, complete: false, reason: 'Blocked by the site or its firewall',
  });
  assert.equal(scoreIsWithheld([coverage('headers'), blocked]), true);
});

test('a blocked unscored check leaves the score intact', () => {
  // A robots.txt disclosure carries no deduction, so missing it does not
  // make the remaining grade flattering.
  const blocked = coverage('robots', {
    requestsFailed: 1, complete: false, reason: 'The request failed or timed out',
  });
  assert.equal(scoreIsWithheld([coverage('headers'), blocked]), false);
});

test('a provider check that does not apply leaves the score intact', () => {
  assert.equal(scoreIsWithheld([
    coverage('supabase', { applicable: false, complete: true, reason: 'Not applicable' }),
  ]), false);
});

test('informational-only discovery phases do not withhold the score', () => {
  for (const phaseId of ['graphql', 'apidocs', 'idor', 'components', 'info']) {
    assert.equal(SCORED_PHASE_IDS.has(phaseId), false, phaseId);
  }
  assert.equal(SCORED_PHASE_IDS.has('serverstatus'), true);
});

test('a blocked check reports a plain-language reason, not a status code', () => {
  assert.equal(describeCoverageFailure({ blocked: 1, failed: 0 }), 'Blocked by the site or its firewall');
  assert.equal(describeCoverageFailure({ blocked: 0, failed: 1 }), 'The request failed or timed out');
  assert.equal(describeCoverageFailure({ blocked: 0, failed: 0 }), null);
});

test('being blocked outranks having failed when both happened', () => {
  assert.equal(describeCoverageFailure({ blocked: 1, failed: 3 }), 'Blocked by the site or its firewall');
});

test('the coverage banner lists every check that produced no answer', () => {
  const checks = [
    coverage('headers'),
    coverage('files', { complete: false, reason: 'Blocked by the site or its firewall' }),
    coverage('robots', { complete: false, reason: 'The request failed or timed out' }),
  ];
  assert.deepEqual(incompleteChecks(checks).map(c => c.phaseId), ['files', 'robots']);
});

test('every scored phase is a real lane member', () => {
  const known = new Set<string>([...SURFACE_PHASE_IDS, ...DEEP_ONLY_PHASE_IDS]);
  const unknown = [...SCORED_PHASE_IDS].filter(id => !known.has(id));
  assert.deepEqual(unknown, [], `scored phases absent from both lanes: ${unknown.join(', ')}`);
});
