import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverApplicationSurface, queryInputsFor } from '../lib/application-inputs';

test('discovers same-origin GET inputs and preserves a submitted application path', () => {
  const surface = discoverApplicationSurface('https://example.com/app/start', [`
    <form action="search" method="get">
      <input type="search" name="q">
      <input type="hidden" name="csrf">
    </form>
    <a href="/catalog?item=42">item</a>
  `]);
  assert.equal(surface.forms[0].action, 'https://example.com/app/search');
  assert.deepEqual(surface.queryInputs.map(input => input.parameter), ['q', 'item']);
  assert.deepEqual(queryInputsFor(surface, 'sql').map(input => input.parameter), ['q', 'item']);
});

test('identifies login POST forms without turning them into automatic GET probes', () => {
  const surface = discoverApplicationSurface('https://example.com/', [`
    <form action="/session" method="post">
      <input name="email" type="email">
      <input name="password" type="password">
    </form>
  `]);
  assert.equal(surface.forms[0].purpose, 'login');
  assert.equal(surface.forms[0].method, 'POST');
  assert.equal(surface.queryInputs.length, 0);
});

test('rejects cross-origin form actions and links', () => {
  const surface = discoverApplicationSurface('https://example.com/', [`
    <form action="https://attacker.example/login"><input name="email"></form>
    <a href="https://attacker.example/?q=x">away</a>
  `]);
  assert.deepEqual(surface.forms, []);
  assert.deepEqual(surface.queryInputs, []);
  assert.deepEqual(surface.sameOriginRoutes, []);
});

test('routes inputs to checks by actual parameter meaning', () => {
  const surface = discoverApplicationSurface('https://example.com/', [`
    <form method="get">
      <input name="search"><input name="redirect_url"><input name="file"><input name="webhook">
    </form>
  `]);
  assert.deepEqual(queryInputsFor(surface, 'reflection').map(input => input.parameter), ['search']);
  assert.deepEqual(queryInputsFor(surface, 'redirect').map(input => input.parameter), ['redirect_url']);
  assert.deepEqual(queryInputsFor(surface, 'traversal').map(input => input.parameter), ['file']);
  assert.deepEqual(queryInputsFor(surface, 'ssrf').map(input => input.parameter), ['webhook']);
});

test('discovers concrete query URL literals from browser JavaScript', () => {
  const surface = discoverApplicationSurface('https://example.com/app', [
    `const endpoint = '/api/search?q='; const next = '/continue?redirect_url=/home';`,
  ]);
  assert.deepEqual(surface.queryInputs.map(input => input.parameter), ['q', 'redirect_url']);
});
