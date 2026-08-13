import assert from 'node:assert/strict';
import test from 'node:test';
import { ScanRequestScheduler } from '../lib/scan-request-scheduler';

test('serialises concurrent callers and spaces normal request starts', async () => {
  let clock = 0;
  const starts: number[] = [];
  let active = 0;
  let maxActive = 0;
  const scheduler = new ScanRequestScheduler({
    intervalMs: 750,
    now: () => clock,
    sleep: async milliseconds => { clock += milliseconds; },
  });

  await Promise.all([1, 2, 3].map(value => scheduler.run(async () => {
    starts.push(clock);
    active += 1;
    maxActive = Math.max(maxActive, active);
    clock += 10;
    active -= 1;
    return value;
  })));

  assert.deepEqual(starts, [0, 750, 1500]);
  assert.equal(maxActive, 1);
  assert.equal(scheduler.maxActiveRequests, 1);
});

test('rapid series remains serial but deliberately skips normal pacing', async () => {
  let clock = 0;
  const starts: number[] = [];
  const scheduler = new ScanRequestScheduler({
    intervalMs: 750,
    now: () => clock,
    sleep: async milliseconds => { clock += milliseconds; },
  });

  await Promise.all([1, 2, 3].map(() => scheduler.run(async () => {
    starts.push(clock);
    clock += 5;
  }, { rapidSeries: true })));

  assert.deepEqual(starts, [0, 5, 10]);
  assert.equal(scheduler.maxActiveRequests, 1);
});
