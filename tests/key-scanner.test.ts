import assert from 'node:assert/strict';
import test from 'node:test';
import { scanForPublicKeys } from '../lib/key-scanner';

test('an AWS access-key identifier alone is context, not a secret leak', () => {
  const findings = scanForPublicKeys('<script>const id = "AKIAABCDEFGHIJKLMNOP";</script>');
  const aws = findings.find(finding => finding.type.startsWith('AWS Access Key ID'));
  assert.equal(aws?.risk, 'low');
});

test('a token pattern that includes secret material remains high risk', () => {
  const findings = scanForPublicKeys(`<script>const token = "ghp_${'A1b2'.repeat(10)}";</script>`);
  assert.equal(findings.find(finding => finding.type === 'GitHub Token')?.risk, 'high');
});

test('current GitHub token families are detected while placeholders are ignored', () => {
  for (const token of [
    `gho_${'A1b2'.repeat(10)}`,
    `ghu_${'C3d4'.repeat(10)}`,
    `github_pat_${'Ab1_'.repeat(12)}`,
  ]) {
    assert.equal(
      scanForPublicKeys(`<script>const token = "${token}";</script>`)
        .some(finding => finding.type === 'GitHub Token'),
      true,
      token.slice(0, 12),
    );
  }

  assert.equal(
    scanForPublicKeys(`<script>const token = "ghp_${'x'.repeat(40)}";</script>`)
      .some(finding => finding.type === 'GitHub Token'),
    false,
  );
});

test('modern Supabase secret keys are distinguished from publishable keys', () => {
  const findings = scanForPublicKeys([
    `sb_secret_${'S3cr'.repeat(8)}`,
    `sb_publishable_${'P4bl'.repeat(8)}`,
  ].join(' '));
  assert.equal(findings.find(finding => finding.type === 'Supabase Secret Key')?.risk, 'high');
  assert.equal(findings.find(finding => finding.type === 'Supabase Publishable Key')?.risk, 'info');
});
