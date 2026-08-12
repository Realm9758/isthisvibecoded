import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SURFACE_PHASE_IDS,
  DEEP_ONLY_PHASE_IDS,
  phaseRunsInLane,
  phasesForLane,
  LANE_CHECK_COUNTS,
} from '../lib/scan-lanes';
import { SCAN_PHASES } from '../lib/scan-phases';

const EXPECTED_SURFACE = [
  'vibe', 'files', 'headers', 'cookies', 'ssl',
  'dirlist', 'robots', 'sri', 'info', 'components', 'sourcemaps',
  'apidocs',
];

const EXPECTED_DEEP_ONLY = [
  'xss', 'sqli', 'nosql', 'traversal', 'ssrf', 'crlf', 'hostheader',
  'redirect', 'errors', 'admin', 'forced', 'idor', 'cors', 'graphql',
  'supabase', 'firebase', 'storage', 'nextauth', 'serverstatus',
];

test('the surface lane contains only browser or crawler class reads', () => {
  assert.deepEqual([...SURFACE_PHASE_IDS].sort(), [...EXPECTED_SURFACE].sort());
  assert.equal(SURFACE_PHASE_IDS.length, 12);
});

test('the deep lane adds payload, application-entry, and provider checks', () => {
  assert.deepEqual([...DEEP_ONLY_PHASE_IDS].sort(), [...EXPECTED_DEEP_ONLY].sort());
  assert.equal(DEEP_ONLY_PHASE_IDS.length, 19);
});

test('no check is in both lanes', () => {
  const overlap = (SURFACE_PHASE_IDS as readonly string[])
    .filter(id => (DEEP_ONLY_PHASE_IDS as readonly string[]).includes(id));
  assert.deepEqual(overlap, []);
});

test('every scanner phase except the framing phases is assigned to a lane', () => {
  const assigned = new Set<string>([...SURFACE_PHASE_IDS, ...DEEP_ONLY_PHASE_IDS, 'init', 'done']);
  const unassigned = SCAN_PHASES.map(p => p.id).filter(id => !assigned.has(id));
  assert.deepEqual(unassigned, [], `unassigned phases: ${unassigned.join(', ')}`);
});

test('every assigned lane member is a real scanner phase', () => {
  const known = new Set(SCAN_PHASES.map(p => p.id));
  const unknown = [...SURFACE_PHASE_IDS, ...DEEP_ONLY_PHASE_IDS].filter(id => !known.has(id));
  assert.deepEqual(unknown, [], `phases named in a lane but absent from the scanner: ${unknown.join(', ')}`);
});

test('the surface lane never runs a payload-sending check', () => {
  for (const id of DEEP_ONLY_PHASE_IDS) {
    assert.equal(phaseRunsInLane(id, 'surface'), false, `${id} must not run in the surface lane`);
  }
});

test('the deep lane runs every check', () => {
  for (const id of [...SURFACE_PHASE_IDS, ...DEEP_ONLY_PHASE_IDS]) {
    assert.equal(phaseRunsInLane(id, 'deep'), true, `${id} must run in the deep lane`);
  }
});

test('framing phases run in both lanes', () => {
  for (const lane of ['surface', 'deep'] as const) {
    assert.equal(phaseRunsInLane('init', lane), true);
    assert.equal(phaseRunsInLane('done', lane), true);
  }
});

test('phasesForLane streams only the phases that will actually run', () => {
  const surface = phasesForLane(SCAN_PHASES, 'surface').map(p => p.id);
  assert.equal(surface.length, 14, 'twelve checks plus init and done');
  assert.equal(surface.includes('sqli'), false);
  assert.equal(surface.includes('files'), true);

  const deep = phasesForLane(SCAN_PHASES, 'deep').map(p => p.id);
  assert.equal(deep.length, SCAN_PHASES.length);
});

test('the advertised check counts match the lanes', () => {
  assert.equal(LANE_CHECK_COUNTS.surface, 12);
  assert.equal(LANE_CHECK_COUNTS.deep, 31);
});
