import assert from 'node:assert/strict';
import test from 'node:test';
import { scanForPublicKeys } from '../lib/key-scanner';

test('an AWS access-key identifier alone is context, not a secret leak', () => {
  const findings = scanForPublicKeys('<script>const id = "AKIAABCDEFGHIJKLMNOP";</script>');
  const aws = findings.find(finding => finding.type.startsWith('AWS Access Key ID'));
  assert.equal(aws?.risk, 'low');
});

test('a token pattern that includes secret material remains high risk', () => {
  const findings = scanForPublicKeys(`<script>const token = "ghp_${'a'.repeat(40)}";</script>`);
  assert.equal(findings.find(finding => finding.type === 'GitHub Token')?.risk, 'high');
});

