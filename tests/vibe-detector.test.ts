import assert from 'node:assert/strict';
import test from 'node:test';
import { detectVibe } from '../lib/vibe-detector';

const BASIC_HTML = '<!doctype html><html><head><title>Acme</title></head><body><main>Welcome</main></body></html>';

test('ordinary HTML abstains instead of claiming human authorship', () => {
  const result = detectVibe(BASIC_HTML, {}, 'https://example.com');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
  assert.equal(result.confidence, 'Low');
  assert.deepEqual(result.reasons, []);
});

test('a commodity modern stack cannot create a positive verdict', () => {
  const html = `<!doctype html><html><body>
    <script src="/_next/static/chunks/app.js"></script>
    <div data-slot="card" class="text-muted-foreground">supabase.co</div>
  </body></html>`;
  const result = detectVibe(html, { 'x-vercel-id': 'lhr1::abc' }, 'https://hand-built.vercel.app');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
  assert.ok(result.signals.some(signal => signal.id === 'modern-scaffold-stack-four' && signal.direction === 'context'));
});

test('generic copy, placeholder content, and a starter title remain contextual only', () => {
  const html = `<!doctype html><html><head><title>Create Next App</title></head><body>
    <p>Transform your workflow. Unlock the full potential. Seamlessly integrate everything.</p>
    <p>Get started for free. No credit card required. Lorem ipsum.</p>
    <img src="https://placehold.co/600x400" alt="placeholder">
  </body></html>`;
  const result = detectVibe(html, {}, 'https://example.com');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
});

test('a page discussing AI builders does not become builder provenance', () => {
  const html = `<!doctype html><html><body>
    <article>We compared Lovable, v0.dev, Bolt.new, and Base44 for this review.</article>
    <a href="https://v0.dev">Read our v0 review</a>
  </body></html>`;
  const result = detectVibe(html, {}, 'https://reviews.example');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
});

test('an alternative CMS generator is conflicting context, not AI evidence', () => {
  const html = '<html><head><meta name="generator" content="WordPress 6.8"></head><body></body></html>';
  const result = detectVibe(html, {}, 'https://example.com');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
  assert.ok(result.signals.some(signal => signal.direction === 'conflicts'));
});

test('explicit AI-builder generator metadata is direct provenance', () => {
  const html = '<html><head><meta name="generator" content="Lovable"></head><body></body></html>';
  const result = detectVibe(html, {}, 'https://custom.example');
  assert.equal(result.score, 80);
  assert.equal(result.label, 'Direct AI-builder provenance');
  assert.equal(result.confidence, 'High');
  assert.equal(result.declaredGenerator, 'Lovable');
});

test('a generator field that merely mentions a builder is not direct provenance', () => {
  const html = '<html><head><meta name="generator" content="Custom CMS — not Lovable"></head><body></body></html>';
  const result = detectVibe(html, {}, 'https://custom.example');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
});

test('generator metadata must be an exact builder declaration, not a builder-themed product name', () => {
  const html = '<html><head><meta name="generator" content="Lovable WordPress theme"></head><body></body></html>';
  const result = detectVibe(html, {}, 'https://custom.example');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
});

test('an AI-builder project hostname is strong evidence but not direct declaration', () => {
  const result = detectVibe(BASIC_HTML, {}, 'https://demo.lovable.app');
  assert.equal(result.score, 58);
  assert.equal(result.label, 'Strong supporting evidence');
  assert.equal(result.confidence, 'Medium');
});

test('a real built-with attribution is accepted while a plain link is not', () => {
  const attributed = detectVibe(
    '<html><body><a href="https://lovable.dev/projects/abc">Built with Lovable</a></body></html>',
    {},
    'https://example.com',
  );
  const plainLink = detectVibe(
    '<html><body><a href="https://lovable.dev/projects/abc">See our integration partner</a></body></html>',
    {},
    'https://example.com',
  );
  assert.equal(attributed.score, 60);
  assert.equal(plainLink.score, 0);
});

test('correlated observations from one builder do not double count', () => {
  const html = `<!doctype html><html><head><meta name="generator" content="Lovable"></head><body>
    <a href="https://lovable.dev/projects/abc">Built with Lovable</a>
    <img src="https://cdn.example/lovable-uploads/hero.png" alt="hero">
  </body></html>`;
  const result = detectVibe(html, {}, 'https://demo.lovable.app');
  assert.equal(result.breakdown.provenance, 80);
  assert.equal(result.score, 80);
});

test('Bolt comment, hostname, and attribution share one correlation family', () => {
  const html = `<!doctype html><html><body>
    <!-- Built with Bolt -->
    <a href="https://bolt.new/project/abc">Built with Bolt</a>
  </body></html>`;
  const result = detectVibe(html, {}, 'https://demo.bolt.host');
  assert.equal(result.breakdown.provenance, 52);
  assert.equal(result.score, 52);
});

test('negated builder attributions are not positive provenance', () => {
  const html = `<!doctype html><html><body>
    <!-- This site was not built with Lovable -->
    <a href="https://lovable.dev">Never built with Lovable</a>
  </body></html>`;
  const result = detectVibe(html, {}, 'https://example.com');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
});

test('general-purpose Replit hosting alone is contextual only', () => {
  const result = detectVibe(BASIC_HTML, {}, 'https://manual-project.replit.app');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
  assert.ok(result.signals.some(signal => signal.id === 'replit-hosting-context'));
});

test('general-purpose StackBlitz hosting is not treated as AI provenance', () => {
  const result = detectVibe(BASIC_HTML, {}, 'https://manual-project.stackblitz.io');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
});

test('visible discussion of Replit Agent is not a provenance marker', () => {
  const result = detectVibe(
    '<html><body><article>Our team reviewed Replit Agent for this report.</article></body></html>',
    {},
    'https://reviews.example',
  );
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
});

test('the result is deterministic and bounded', () => {
  const html = '<html><head><meta name="generator" content="Lovable"></head><body></body></html>';
  const first = detectVibe(html, {}, 'https://demo.lovable.app');
  const second = detectVibe(html, {}, 'https://demo.lovable.app');
  assert.deepEqual(first, second);
  assert.ok(first.score >= 0 && first.score <= 100);
});

test('malformed numeric HTML entities cannot crash the detector', () => {
  const html = '<html><body>&#1114112; &#x110000; &#55296;</body></html>';
  const result = detectVibe(html, {}, 'https://example.com');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'Inconclusive');
});
