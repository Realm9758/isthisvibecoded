import assert from 'node:assert/strict';
import test from 'node:test';
import {
  explainPhaseReason,
  formatFindingCount,
  formatTerminalPhaseLog,
} from '../lib/scan-progress-presentation';

test('a covered phase with no findings gets an explicitly clean completion line', () => {
  assert.equal(formatTerminalPhaseLog({
    label: 'Security Headers',
    status: 'complete',
    findingCount: 0,
  }), '[✓] Security Headers: check complete, no matching findings');
});

test('a covered phase with findings is never rendered as a green check', () => {
  const line = formatTerminalPhaseLog({
    label: 'Security Headers',
    status: 'complete',
    findingCount: 2,
    findingSeverities: ['high', 'low'],
  });

  assert.equal(line, '[!] Security Headers: check complete with 2 findings (1 high, 1 low)');
  assert.equal(line.startsWith('[✓]'), false);
});

test('an incomplete phase retains both its findings and coverage reason', () => {
  assert.equal(formatTerminalPhaseLog({
    label: 'Sensitive Files',
    status: 'incomplete',
    findingCount: 2,
    findingSeverities: ['critical', 'critical'],
    reason: 'Two requests timed out',
  }), '[!] Sensitive Files: 2 findings (2 critical) reported; coverage also inconclusive, Two requests timed out');
});

test('an incomplete phase without findings uses the inconclusive marker', () => {
  assert.equal(formatTerminalPhaseLog({
    label: 'Sensitive Files',
    status: 'incomplete',
    findingCount: 0,
    reason: 'One or more requests were blocked before they could be evaluated',
  }), '[?] Sensitive Files: coverage inconclusive, The site rejected or challenged one or more requests, so this check could not inspect the response.');
});

test('not-applicable remains distinct from both clean and inconclusive', () => {
  assert.equal(formatTerminalPhaseLog({
    label: 'Supabase Access',
    status: 'not_applicable',
    findingCount: 0,
    reason: 'No Supabase configuration was discovered',
  }), '[-] Supabase Access: not applicable, No Supabase configuration was discovered');
});

test('unexpected findings are not hidden by a not-applicable status', () => {
  assert.equal(formatTerminalPhaseLog({
    label: 'Supabase Access',
    status: 'not_applicable',
    findingCount: 1,
    findingSeverities: ['high'],
  }), '[!] Supabase Access: 1 finding (1 high) reported; phase also marked not applicable');
});

test('finding count labels are grammatical and reject invalid values', () => {
  assert.equal(formatFindingCount(1), '1 finding');
  assert.equal(formatFindingCount(2), '2 findings');
  assert.equal(formatFindingCount(Number.NaN), '0 findings');
});

test('technical transport reasons become plain client-facing explanations', () => {
  assert.equal(
    explainPhaseReason('SQL injection control request did not return a usable response'),
    'The normal comparison request did not produce a usable response, so this check made no vulnerability claim.',
  );
  assert.equal(
    explainPhaseReason('One or more requests were blocked before they could be evaluated'),
    'The site rejected or challenged one or more requests, so this check could not inspect the response.',
  );
});
