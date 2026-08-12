import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSourceMap,
  hasSourceMapDisclosure,
  sourceMapUrlCandidates,
} from '../lib/source-map-evidence';

test('source map candidates prefer the last declared URL and retain a bounded fallback', () => {
  const candidates = sourceMapUrlCandidates(
    'https://example.com/assets/app.js?v=42#fragment',
    [
      '//# sourceMappingURL=old.map',
      'console.log("ready")',
      '/*# sourceMappingURL=maps/app.abc.map?build=42 */',
    ].join('\n'),
    'https://example.com',
  );

  assert.deepEqual(candidates, [
    'https://example.com/assets/maps/app.abc.map?build=42',
    'https://example.com/assets/app.js.map?v=42',
  ]);
});

test('source map candidates reject cross-origin and non-http declarations', () => {
  assert.deepEqual(
    sourceMapUrlCandidates(
      'https://example.com/app.js',
      '//# sourceMappingURL=https://cdn.example.net/private.map',
      'https://example.com',
    ),
    ['https://example.com/app.js.map'],
  );

  assert.deepEqual(
    sourceMapUrlCandidates(
      'https://example.com/app.js',
      '//# sourceMappingURL=data:application/json;base64,e30=',
      'https://example.com',
    ),
    ['https://example.com/app.js.map'],
  );

  assert.deepEqual(
    sourceMapUrlCandidates('https://cdn.example.net/app.js', '', 'https://example.com'),
    [],
  );
});

test('regular v3 source maps distinguish embedded content from path and mapping metadata', () => {
  const withContent = assessSourceMap(JSON.stringify({
    version: 3,
    sources: ['src/main.ts', 'src/empty.ts', 'src/not-embedded.ts'],
    sourcesContent: ['const secret = false;', '', null],
    names: [],
    mappings: 'AAAA',
  }));
  assert.deepEqual(withContent, {
    format: 'regular',
    sourceCount: 3,
    embeddedSourceCount: 1,
    mappingCharacters: 4,
    referencedSectionCount: 0,
  });
  assert.equal(withContent && hasSourceMapDisclosure(withContent), true);

  const metadataOnly = assessSourceMap(JSON.stringify({
    version: 3,
    sources: ['webpack://app/src/main.ts'],
    mappings: 'AAAA',
  }));
  assert.equal(metadataOnly?.embeddedSourceCount, 0);
  assert.equal(metadataOnly?.sourceCount, 1);
});

test('indexed v3 source maps aggregate embedded maps and external section references', () => {
  const assessment = assessSourceMap(JSON.stringify({
    version: 3,
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: {
          version: 3,
          sources: ['src/a.ts'],
          sourcesContent: ['export const a = 1;'],
          mappings: 'AAAA',
        },
      },
      {
        offset: { line: 10, column: 0 },
        map: {
          version: 3,
          sources: ['src/b.ts'],
          mappings: 'BBBB',
        },
      },
      {
        offset: { line: 20, column: 0 },
        url: 'chunk-three.map',
      },
    ],
  }));

  assert.deepEqual(assessment, {
    format: 'indexed',
    sourceCount: 2,
    embeddedSourceCount: 1,
    mappingCharacters: 8,
    referencedSectionCount: 1,
  });
});

test('source map validation rejects SPA JSON and malformed indexed maps', () => {
  assert.equal(assessSourceMap('{"page":"home"}'), null);
  assert.equal(assessSourceMap('{not json'), null);
  assert.equal(assessSourceMap(JSON.stringify({
    version: 3,
    sources: ['src/main.ts'],
  })), null);
  assert.equal(assessSourceMap(JSON.stringify({
    version: 3,
    sections: [{ offset: { line: -1, column: 0 }, url: 'chunk.map' }],
  })), null);
  assert.equal(assessSourceMap(JSON.stringify({
    version: 3,
    sections: [{
      offset: { line: 0, column: 0 },
      map: { version: 3, sources: [], mappings: '' },
      url: 'ambiguous.map',
    }],
  })), null);
});

test('empty but structurally valid maps are not treated as disclosure evidence', () => {
  const assessment = assessSourceMap(JSON.stringify({ version: 3, sources: [], mappings: '' }));
  assert.ok(assessment);
  assert.equal(hasSourceMapDisclosure(assessment), false);
});
