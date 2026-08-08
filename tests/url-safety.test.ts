import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePublicTarget } from '../lib/url-safety';

test('direct public addresses can be pinned without a second DNS lookup', async () => {
  assert.deepEqual(
    await resolvePublicTarget(new URL('https://93.184.216.34/')),
    [{ address: '93.184.216.34', family: 4 }],
  );
});

test('private, link-local, metadata, and documentation addresses are rejected', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '192.0.2.1',
    '[::1]',
    '[fd00::1]',
    '[2001:db8::1]',
  ]) {
    await assert.rejects(
      resolvePublicTarget(new URL(`http://${address}/`)),
      /Private\/local|Private\/local network/,
    );
  }
});
