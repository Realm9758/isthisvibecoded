import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDeepScore } from '../lib/deep-score';
import type { DeepFinding, DeepFindingSeverity } from '../types/deep-scan';

function finding(id: string, severity: DeepFindingSeverity): DeepFinding {
  return {
    id,
    category: 'injection',
    severity,
    title: id,
    description: id,
    remediation: id,
  };
}

test('severity ceilings align with displayed grade boundaries', () => {
  assert.equal(calculateDeepScore([finding('critical-a', 'critical')]), 24);
  assert.equal(calculateDeepScore([finding('high-a', 'high')]), 49);
  assert.equal(calculateDeepScore([finding('medium-a', 'medium')]), 74);
  assert.equal(calculateDeepScore([finding('low-a', 'low')]), 89);
  assert.equal(calculateDeepScore([finding('info-a', 'info')]), 100);
});

test('independent rules accumulate while duplicate evidence does not', () => {
  assert.equal(calculateDeepScore([finding('critical-a', 'critical')]), 24);
  assert.equal(
    calculateDeepScore([finding('critical-a', 'critical'), finding('critical-b', 'critical')]),
    16,
  );
  assert.equal(
    calculateDeepScore([finding('high-a', 'high'), finding('high-a', 'high')]),
    49,
  );
});

test('cookie count cannot dominate the score for one repeated attribute', () => {
  const one = calculateDeepScore([finding('cookie-secure-session', 'medium')]);
  const many = calculateDeepScore([
    finding('cookie-secure-session', 'medium'),
    finding('cookie-secure-preferences', 'medium'),
  ]);
  assert.equal(many, one);
});
