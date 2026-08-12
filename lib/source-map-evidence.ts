export type SourceMapAssessment = {
  format: 'regular' | 'indexed';
  sourceCount: number;
  embeddedSourceCount: number;
  mappingCharacters: number;
  referencedSectionCount: number;
};

const MAX_SOURCE_MAP_DIRECTIVE_LENGTH = 2_048;
const MAX_INDEXED_SECTIONS = 128;
const MAX_SOURCE_ENTRIES = 10_000;
const MAX_INDEX_DEPTH = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function extractDeclaredSourceMapUrl(source: string): string | null {
  // Browsers use the last sourceMappingURL declaration in a generated file.
  // Keep parsing bounded because this text came from an untrusted response.
  const directive = /\/\/[@#]\s*sourceMappingURL\s*=\s*([^\r\n]*)|\/\*[@#]\s*sourceMappingURL\s*=\s*([^*]*)\*\//g;
  let declared: string | null = null;

  for (const match of source.matchAll(directive)) {
    const raw = (match[1] ?? match[2] ?? '').trim();
    if (!raw || raw.length > MAX_SOURCE_MAP_DIRECTIVE_LENGTH) continue;
    const token = raw.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
    const value = token?.[1] ?? token?.[2] ?? token?.[3] ?? null;
    if (value && value.length <= MAX_SOURCE_MAP_DIRECTIVE_LENGTH) declared = value;
  }

  return declared;
}

/**
 * Return at most two exact-origin candidates: the bundle's declared map first,
 * then the conventional `<bundle pathname>.map` fallback when it differs.
 */
export function sourceMapUrlCandidates(
  bundleUrl: string,
  bundleSource: string,
  allowedOrigin: string,
): string[] {
  let bundle: URL;
  let origin: string;
  try {
    bundle = new URL(bundleUrl);
    origin = new URL(allowedOrigin).origin;
  } catch {
    return [];
  }

  if (
    (bundle.protocol !== 'http:' && bundle.protocol !== 'https:')
    || bundle.origin !== origin
    || bundle.username
    || bundle.password
  ) {
    return [];
  }

  const candidates: string[] = [];
  const declared = extractDeclaredSourceMapUrl(bundleSource);
  if (declared) {
    try {
      const declaredUrl = new URL(declared, bundle);
      declaredUrl.hash = '';
      if (
        (declaredUrl.protocol === 'http:' || declaredUrl.protocol === 'https:')
        && declaredUrl.origin === origin
        && !declaredUrl.username
        && !declaredUrl.password
      ) {
        candidates.push(declaredUrl.href);
      }
    } catch {
      // A malformed or non-URL declaration may still have a conventional map.
    }
  }

  const fallback = new URL(bundle.href);
  fallback.hash = '';
  fallback.pathname = `${fallback.pathname}.map`;
  if (!candidates.includes(fallback.href)) candidates.push(fallback.href);

  return candidates.slice(0, 2);
}

function assessMapObject(value: unknown, depth: number): SourceMapAssessment | null {
  if (!isRecord(value) || value.version !== 3 || depth > MAX_INDEX_DEPTH) return null;

  if (Array.isArray(value.sections)) {
    if (value.sections.length === 0 || value.sections.length > MAX_INDEXED_SECTIONS) return null;

    const assessment: SourceMapAssessment = {
      format: 'indexed',
      sourceCount: 0,
      embeddedSourceCount: 0,
      mappingCharacters: 0,
      referencedSectionCount: 0,
    };

    for (const section of value.sections) {
      if (!isRecord(section) || !isRecord(section.offset)) return null;
      const { line, column } = section.offset;
      if (
        !Number.isInteger(line)
        || !Number.isInteger(column)
        || (line as number) < 0
        || (column as number) < 0
      ) {
        return null;
      }

      const hasMap = own(section, 'map');
      const hasUrl = own(section, 'url');
      if (hasMap === hasUrl) return null;

      if (hasMap) {
        const child = assessMapObject(section.map, depth + 1);
        if (!child) return null;
        assessment.sourceCount += child.sourceCount;
        assessment.embeddedSourceCount += child.embeddedSourceCount;
        assessment.mappingCharacters += child.mappingCharacters;
        assessment.referencedSectionCount += child.referencedSectionCount;
        continue;
      }

      if (
        typeof section.url !== 'string'
        || section.url.length === 0
        || section.url.length > MAX_SOURCE_MAP_DIRECTIVE_LENGTH
      ) {
        return null;
      }
      assessment.referencedSectionCount++;
    }

    return assessment;
  }

  if (
    !Array.isArray(value.sources)
    || value.sources.length > MAX_SOURCE_ENTRIES
    || !value.sources.every(source => typeof source === 'string')
    || typeof value.mappings !== 'string'
  ) {
    return null;
  }

  const sourcesContent = Array.isArray(value.sourcesContent) ? value.sourcesContent : [];
  const embeddedSourceCount = value.sources.reduce((count, _source, index) => {
    const content = sourcesContent[index];
    return count + (typeof content === 'string' && content.length > 0 ? 1 : 0);
  }, 0);

  return {
    format: 'regular',
    sourceCount: value.sources.length,
    embeddedSourceCount,
    mappingCharacters: value.mappings.length,
    referencedSectionCount: 0,
  };
}

/** Parse and structurally validate regular and indexed version-3 source maps. */
export function assessSourceMap(body: string): SourceMapAssessment | null {
  try {
    return assessMapObject(JSON.parse(body) as unknown, 0);
  } catch {
    return null;
  }
}

export function hasSourceMapDisclosure(assessment: SourceMapAssessment): boolean {
  return assessment.sourceCount > 0
    || assessment.mappingCharacters > 0
    || assessment.referencedSectionCount > 0;
}
