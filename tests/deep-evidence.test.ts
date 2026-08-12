import assert from 'node:assert/strict';
import test from 'node:test';
import { findStripeSecretEvidence, validateSensitiveFileEvidence } from '../lib/deep-evidence';

test('environment files classify configuration separately from confirmed secrets', () => {
  assert.equal(
    validateSensitiveFileEvidence('/.env', 'NODE_ENV=production\nAPP_NAME=Acme', 'text/plain')?.severity,
    'info',
  );
  assert.equal(
    validateSensitiveFileEvidence('/.env', 'DATABASE_URL=replace-me\nAPP_NAME=Acme', 'text/plain'),
    null,
  );
  const uncredentialed = validateSensitiveFileEvidence('/.env', 'DATABASE_URL=postgres://db.internal/acme\nAPP_NAME=Acme', 'text/plain');
  assert.equal(uncredentialed?.severity, 'medium');
  assert.match(uncredentialed?.evidence ?? '', /no password or token/);
  const credentialed = validateSensitiveFileEvidence('/.env', 'DATABASE_URL=postgres://user:secretpass@db.internal/acme', 'text/plain');
  assert.equal(credentialed?.severity, undefined);
  const openAiSecret = validateSensitiveFileEvidence(
    '/.env',
    `OPENAI_API_KEY=sk-proj-${'a'.repeat(32)}`,
    'text/plain',
  );
  assert.ok(openAiSecret);
  assert.equal(openAiSecret.severity, undefined);
  const awsSecret = validateSensitiveFileEvidence(
    '/.env',
    `AWS_ACCESS_KEY_ID=AKIA${'A'.repeat(16)}\nAWS_SECRET_ACCESS_KEY=${'b'.repeat(40)}`,
    'text/plain',
  );
  assert.ok(awsSecret);
  assert.equal(awsSecret.severity, undefined);
  assert.equal(
    validateSensitiveFileEvidence('/.env', `NEXT_PUBLIC_FIREBASE_API_KEY=${'c'.repeat(32)}`, 'text/plain'),
    null,
  );
});

test('schema-only SQL is not classified as exposed database rows', () => {
  const schema = validateSensitiveFileEvidence('/backup.sql', 'CREATE TABLE users (id bigint);', 'text/plain');
  assert.equal(schema?.severity, 'medium');
  assert.match(schema?.description ?? '', /did not confirm exposed database rows/);

  const rows = validateSensitiveFileEvidence('/backup.sql', "INSERT INTO users VALUES (1);", 'text/plain');
  assert.equal(rows?.severity, undefined);
  assert.match(rows?.evidence ?? '', /data-row/);

  const headerOnly = validateSensitiveFileEvidence('/backup.sql', '-- MySQL dump 10.13', 'text/plain');
  assert.equal(headerOnly?.severity, 'info');
});

test('empty and placeholder credential fields do not become exposures', () => {
  assert.equal(validateSensitiveFileEvidence('/.npmrc', '_authToken=', 'text/plain'), null);
  assert.equal(validateSensitiveFileEvidence('/config.json', '{"password":""}', 'application/json'), null);
  assert.equal(validateSensitiveFileEvidence('/config.json', '{"password":"replace-me"}', 'application/json'), null);
  assert.match(
    validateSensitiveFileEvidence('/config.json', '{"password":"a-realistic-long-secret"}', 'application/json')?.evidence ?? '',
    /non-placeholder/,
  );
});

test('Stripe test and live secrets receive different bounded classifications', () => {
  const testKey = findStripeSecretEvidence(`window.key='sk_test_${'A1b2'.repeat(8)}'`);
  const liveKey = findStripeSecretEvidence(`window.key='sk_live_${'C3d4'.repeat(8)}'`);
  assert.equal(testKey?.severity, 'high');
  assert.match(testKey?.description ?? '', /does not by itself grant access to live/);
  assert.equal(liveKey?.severity, 'critical');
  assert.match(liveKey?.description ?? '', /within the key permissions/);
  assert.equal(findStripeSecretEvidence(`sk_test_${'x'.repeat(32)}`), null);
  const liveAfterPlaceholder = findStripeSecretEvidence(
    `sk_test_${'x'.repeat(32)} sk_live_${'Z9y8'.repeat(8)}`,
  );
  assert.equal(liveAfterPlaceholder?.severity, 'critical');
  const liveAfterTest = findStripeSecretEvidence(
    `sk_test_${'A1b2'.repeat(8)} sk_live_${'Z9y8'.repeat(8)}`,
  );
  assert.equal(liveAfterTest?.severity, 'critical');
});
