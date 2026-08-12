import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasDifferentialHtmlReflection,
  hasDifferentialSignature,
  hasUnixPasswdEvidence,
} from '../lib/differential-evidence';

test('database signatures must be absent from the successful control', () => {
  const signatures = [/SQLSTATE/i, /MongoServerError/i];

  assert.equal(
    hasDifferentialSignature('text/html: SQLSTATE 42000', 'ordinary page', signatures),
    true,
    'textual evidence is usable regardless of a response MIME label',
  );
  assert.equal(
    hasDifferentialSignature('SQLSTATE 42000', 'documentation mentions SQLSTATE', signatures),
    false,
  );
});

test('differential matching is deterministic with stateful regular expressions', () => {
  const signatures = [/MongoServerError/gi];
  assert.equal(hasDifferentialSignature('MongoServerError', 'normal response', signatures), true);
  assert.equal(hasDifferentialSignature('MongoServerError', 'normal response', signatures), true);
});

test('passwd evidence requires root and a second system account', () => {
  const passwd = [
    'root:x:0:0:root:/root:/bin/bash',
    'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
  ].join('\n');

  assert.equal(hasUnixPasswdEvidence(passwd), true);
  assert.equal(hasUnixPasswdEvidence('<p>Example root:x:0:0 value</p>'), false);
});

test('HTML reflection requires a unique differential marker in an HTML response', () => {
  const markup = '<ironclad-probe data-id="ironclad-123456789"></ironclad-probe>';
  assert.equal(hasDifferentialHtmlReflection(`page ${markup}`, 'page', markup, 'text/html'), true);
  assert.equal(hasDifferentialHtmlReflection(`page ${markup}`, `docs ${markup}`, markup, 'text/html'), false);
  assert.equal(hasDifferentialHtmlReflection(`{"echo":"${markup}"}`, '{}', markup, 'application/json'), false);
  assert.equal(hasDifferentialHtmlReflection('short', '', 'short', 'text/html'), false);
});
