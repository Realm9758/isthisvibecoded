import type {
  ConfidenceLevel,
  VibeEvidenceCategory,
  VibeEvidenceSignal,
  VibeLabel,
  VibeScoreBreakdown,
} from '@/types/analysis';
import { VIBE_MODEL_VERSION, VIBE_SCORE_BANDS } from './vibe-constants';

type DetectorResult = {
  score: number;
  label: VibeLabel;
  confidence: ConfidenceLevel;
  reasons: string[];
  signals: VibeEvidenceSignal[];
  breakdown: VibeScoreBreakdown;
  declaredGenerator?: string;
  limitations: string[];
};

type SignalInput = Omit<VibeEvidenceSignal, 'points'> & { points: number };

const CATEGORY_CAPS: Record<Exclude<VibeEvidenceCategory, 'conflict'>, number> = {
  provenance: 80,
  scaffold: 22,
  stack: 14,
  content: 6,
};

const CONFLICT_CAP = 35;

const AI_GENERATORS: Array<{ id: string; name: string; generatorPattern: RegExp; mentionPattern: RegExp }> = [
  { id: 'lovable', name: 'Lovable', generatorPattern: /^(?:lovable|gpt[ -]?engineer)(?:[ /-]+v?\d+(?:\.\d+){0,3})?$/i, mentionPattern: /\blovable\b|gpt[ -]?engineer/i },
  { id: 'v0', name: 'v0 by Vercel', generatorPattern: /^v0(?:\.dev)?(?: by vercel)?(?:[ /-]+v?\d+(?:\.\d+){0,3})?$/i, mentionPattern: /\bv0(?:\.dev| by vercel)\b/i },
  { id: 'bolt', name: 'Bolt', generatorPattern: /^(?:bolt|bolt\.new|bolt by stackblitz)(?:[ /-]+v?\d+(?:\.\d+){0,3})?$/i, mentionPattern: /\bbolt(?:\.new| by stackblitz)\b/i },
  { id: 'replit-agent', name: 'Replit Agent', generatorPattern: /^replit agent(?:[ /-]+v?\d+(?:\.\d+){0,3})?$/i, mentionPattern: /\breplit agent\b/i },
  { id: 'base44', name: 'Base44', generatorPattern: /^base44(?:[ /-]+v?\d+(?:\.\d+){0,3})?$/i, mentionPattern: /\bbase44\b/i },
  { id: 'wix-ai', name: 'Wix AI', generatorPattern: /^(?:wix ai|wix artificial design intelligence)(?:[ /-]+v?\d+(?:\.\d+){0,3})?$/i, mentionPattern: /\bwix ai\b|artificial design intelligence/i },
  { id: 'framer-ai', name: 'Framer AI', generatorPattern: /^framer ai(?:[ /-]+v?\d+(?:\.\d+){0,3})?$/i, mentionPattern: /\bframer ai\b/i },
];

const ALTERNATIVE_GENERATORS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'WordPress', pattern: /\bwordpress\b/i },
  { name: 'Drupal', pattern: /\bdrupal\b/i },
  { name: 'Joomla', pattern: /\bjoomla!?\b/i },
  { name: 'Squarespace', pattern: /\bsquarespace\b/i },
  { name: 'Webflow', pattern: /\bwebflow\b/i },
  { name: 'Wix', pattern: /^wix(?:\.com)?$/i },
];

const AI_COPY_PATTERNS: RegExp[] = [
  /transform\s+your\s+(workflow|business|life|world)/i,
  /unlock\s+(the\s+)?(full\s+)?potential/i,
  /seamless(ly)?\s+(integrate|experience|workflow)/i,
  /revolutioni[sz]e\s+your/i,
  /all[\s-]in[\s-]one\s+(platform|solution|tool)/i,
  /supercharge\s+your/i,
  /harness\s+the\s+power/i,
  /the\s+future\s+of\s+\w+/i,
  /get\s+started\s+(today|for\s+free|now|in\s+minutes)/i,
  /no\s+credit\s+card\s+required/i,
];

const PLACEHOLDER_DOMAINS = [
  'placeholder.com',
  'via.placeholder',
  'picsum.photos',
  'placehold.co',
  'dummyimage.com',
  'lorempixel.com',
];

function getTags(html: string, tagName: string): string[] {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')) ?? [];
}

function getAttribute(tag: string, attribute: string): string | undefined {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (entity, code: string) => decodeNumericEntity(entity, code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (entity, code: string) => decodeNumericEntity(entity, code, 16));
}

function decodeNumericEntity(entity: string, code: string, radix: number): string {
  const point = Number.parseInt(code, radix);
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
    return entity;
  }
  return String.fromCodePoint(point);
}

function visibleText(html: string): string {
  return decodeHtmlText(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();
}

function getTitle(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? visibleText(match[1]).trim() : '';
}

function getGeneratorMetadata(html: string): string {
  for (const tag of getTags(html, 'meta')) {
    if ((getAttribute(tag, 'name') ?? '').trim().toLowerCase() !== 'generator') continue;
    return decodeHtmlText(getAttribute(tag, 'content') ?? '').trim();
  }
  return '';
}

function getLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const href = getAttribute(`<a ${match[1]}>`, 'href');
    if (href) links.push({ href: decodeHtmlText(href), text: visibleText(match[2]) });
  }
  return links;
}

function getResourceUrls(html: string): string[] {
  const urls: string[] = [];
  for (const tagName of ['script', 'img', 'source', 'link']) {
    for (const tag of getTags(html, tagName)) {
      const value = getAttribute(tag, 'src') ?? getAttribute(tag, 'href');
      if (value) urls.push(decodeHtmlText(value));
    }
  }
  return urls;
}

const ATTRIBUTION_PATTERN = /\b(?:built|generated|created|made|edit(?:ed)?)\s+(?:by|with|in)\b/gi;

function hasPositiveAttribution(value: string): boolean {
  const normalized = decodeHtmlText(
    value.replace(/<!--|-->/g, ' ').replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
  const matches = normalized.matchAll(new RegExp(ATTRIBUTION_PATTERN.source, ATTRIBUTION_PATTERN.flags));
  for (const match of matches) {
    const before = normalized.slice(Math.max(0, (match.index ?? 0) - 32), match.index);
    if (/\b(?:not|never|without|isn't|wasn't|isn’t|wasn’t)\b[^.!?]{0,24}$/i.test(before)) continue;
    return true;
  }
  return false;
}

function hasBuilderAttribution(value: string, builderPattern: RegExp): boolean {
  const normalized = decodeHtmlText(
    value.replace(/<!--|-->/g, ' ').replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
  const matches = normalized.matchAll(new RegExp(ATTRIBUTION_PATTERN.source, ATTRIBUTION_PATTERN.flags));
  for (const match of matches) {
    const matchIndex = match.index ?? 0;
    const beforeAttribution = normalized.slice(Math.max(0, matchIndex - 32), matchIndex);
    if (/\b(?:not|never|without|isn't|wasn't|isn’t|wasn’t)\b[^.!?]{0,24}$/i.test(beforeAttribution)) continue;

    const afterAttribution = normalized
      .slice(matchIndex + match[0].length, matchIndex + match[0].length + 64)
      .split(/[.!?;]/, 1)[0];
    const builderMatch = afterAttribution.match(builderPattern);
    if (!builderMatch || builderMatch.index === undefined) continue;
    const beforeBuilder = afterAttribution.slice(Math.max(0, builderMatch.index - 24), builderMatch.index);
    if (/\b(?:not|never|without|except)\b[^.!?]{0,20}$/i.test(beforeBuilder)) continue;
    return true;
  }
  return false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Signals sharing a correlation key are alternative observations of the same
 * underlying fact. Taking only the strongest prevents a hostname, attribution,
 * and asset URL from one builder being counted as three independent facts.
 */
function cappedCategoryScore(
  signals: VibeEvidenceSignal[],
  category: Exclude<VibeEvidenceCategory, 'conflict'>,
): number {
  const strongestByCorrelation = new Map<string, number>();
  for (const signal of signals) {
    if (signal.category !== category || signal.direction !== 'supports') continue;
    const key = signal.correlationKey ?? signal.id;
    strongestByCorrelation.set(key, Math.max(strongestByCorrelation.get(key) ?? 0, signal.points));
  }
  const sum = [...strongestByCorrelation.values()].reduce((total, points) => total + points, 0);
  return Math.min(CATEGORY_CAPS[category], sum);
}

function conflictScore(signals: VibeEvidenceSignal[]): number {
  const strongestByCorrelation = new Map<string, number>();
  for (const signal of signals) {
    if (signal.category !== 'conflict' || signal.direction !== 'conflicts') continue;
    const key = signal.correlationKey ?? signal.id;
    strongestByCorrelation.set(key, Math.max(strongestByCorrelation.get(key) ?? 0, signal.points));
  }
  return Math.min(
    CONFLICT_CAP,
    [...strongestByCorrelation.values()].reduce((total, points) => total + points, 0),
  );
}

export function detectVibe(
  html: string,
  headers: Record<string, string> = {},
  url?: string,
): DetectorResult {
  const signals: VibeEvidenceSignal[] = [];

  const add = (signal: SignalInput) => {
    if (signals.some(existing => existing.id === signal.id)) return;
    signals.push({ ...signal, points: clamp(Math.round(signal.points), 0, 100) });
  };

  let hostname = '';
  if (url) {
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      // URL validity is handled by the caller. It is simply unavailable here.
    }
  }

  const generator = getGeneratorMetadata(html);
  let declaredGenerator: string | undefined;

  for (const candidate of AI_GENERATORS) {
    if (!candidate.generatorPattern.test(generator)) continue;
    declaredGenerator = candidate.name;
    add({
      id: `declared-generator-${candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      category: 'provenance',
      direction: 'supports',
      strength: 'direct',
      points: 80,
      correlationKey: `builder-${candidate.id}`,
      source: 'metadata',
      description: `Generator metadata explicitly names ${candidate.name}`,
      evidence: generator.slice(0, 160),
    });
    break;
  }

  if (!declaredGenerator && generator) {
    for (const candidate of ALTERNATIVE_GENERATORS) {
      if (!candidate.pattern.test(generator)) continue;
      add({
        id: `alternative-generator-${candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        category: 'conflict',
        direction: 'conflicts',
        strength: 'strong',
        points: 26,
        correlationKey: 'alternative-generator',
        source: 'metadata',
        description: `Generator metadata names ${candidate.name}, an alternative site-building origin`,
        evidence: generator.slice(0, 160),
      });
      break;
    }
  }

  const comments = html.match(/<!--[\s\S]*?-->/g) ?? [];
  for (const candidate of AI_GENERATORS) {
    if (!comments.some(comment => hasBuilderAttribution(comment, candidate.mentionPattern))) continue;
    add({
      id: `builder-comment-${candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      category: 'provenance',
      direction: 'supports',
      strength: 'strong',
      points: 52,
      correlationKey: `builder-${candidate.id}`,
      source: 'markup',
      description: `An HTML comment contains a ${candidate.name} provenance marker`,
    });
  }

  const platformRules: Array<{
    id: string;
    name: string;
    host: (value: string) => boolean;
    attributionHostnames: string[];
    assetPatterns: RegExp[];
    hostPoints: number;
    sourcePoints: number;
  }> = [
    {
      id: 'lovable',
      name: 'Lovable',
      host: value => ['.lovable.app', '.lovableproject.com', '.gptengineer.app'].some(suffix => value.endsWith(suffix)),
      attributionHostnames: ['lovable.app', 'lovable.dev', 'lovableproject.com'],
      assetPatterns: [/lovable-uploads/i],
      hostPoints: 58,
      sourcePoints: 60,
    },
    {
      id: 'v0',
      name: 'v0 by Vercel',
      host: () => false,
      attributionHostnames: ['v0.dev'],
      assetPatterns: [],
      hostPoints: 0,
      sourcePoints: 52,
    },
    {
      id: 'bolt',
      name: 'Bolt / StackBlitz',
      host: value => value.endsWith('.bolt.host'),
      attributionHostnames: ['bolt.new'],
      assetPatterns: [],
      hostPoints: 52,
      sourcePoints: 52,
    },
    {
      id: 'base44',
      name: 'Base44',
      host: value => value.endsWith('.base44.app'),
      attributionHostnames: ['base44.app', 'base44.com'],
      assetPatterns: [/base44-cdn/i],
      hostPoints: 55,
      sourcePoints: 50,
    },
  ];

  for (const platform of platformRules) {
    if (platform.host(hostname)) {
      add({
        id: `${platform.id}-platform-hostname`,
        category: 'provenance',
        direction: 'supports',
        strength: 'strong',
        points: platform.hostPoints,
        correlationKey: `builder-${platform.id}`,
        source: 'hostname',
        description: `The site is hosted on a ${platform.name} project domain`,
        evidence: hostname,
      });
    }
    const attributed = getLinks(html).some(link => {
      const text = link.text.replace(/\s+/g, ' ').trim();
      if (!hasPositiveAttribution(text)) return false;
      try {
        const linkHostname = new URL(link.href, url).hostname.toLowerCase();
        return platform.attributionHostnames.some(
          expected => linkHostname === expected || linkHostname.endsWith(`.${expected}`),
        );
      } catch {
        return false;
      }
    });
    const builderAsset = getResourceUrls(html).some(value => {
      return platform.assetPatterns.some(pattern => pattern.test(value));
    });
    if (attributed || builderAsset) {
      add({
        id: `${platform.id}-source-marker`,
        category: 'provenance',
        direction: 'supports',
        strength: 'strong',
        points: platform.sourcePoints,
        correlationKey: `builder-${platform.id}`,
        source: 'markup',
        description: attributed
          ? `A public “built with” attribution links to ${platform.name}`
          : `${platform.name}-specific project assets appear in the public source`,
      });
    }
  }

  // Replit is a general-purpose host. It is supporting context, never direct AI provenance.
  const replitHost = hostname.endsWith('.replit.app') || hostname.endsWith('.repl.co');
  const replitAgentMarker = /data-replit-agent(?:\s|=|>)/i.test(html);
  if (replitAgentMarker) {
    add({
      id: 'replit-agent-marker',
      category: 'provenance',
      direction: 'supports',
      strength: 'strong',
      points: 50,
      correlationKey: 'builder-replit-agent',
      source: 'markup',
      description: 'A Replit Agent provenance marker appears in the public source',
    });
  } else if (replitHost) {
    add({
      id: 'replit-hosting-context',
      category: 'stack',
      direction: 'context',
      strength: 'weak',
      points: 0,
      correlationKey: 'cloud-host',
      source: 'hostname',
      description: 'Hosted on Replit; hosting alone does not identify how the code was written',
      evidence: hostname,
    });
  }

  const title = getTitle(html);
  if (/^(Create Next App|My App|Next\.js App|Vite \+ React|React App|Your App Name|Vite App|SvelteKit App|T3 App)$/i.test(title)) {
    add({
      id: 'default-framework-title',
      category: 'scaffold',
      direction: 'context',
      strength: 'weak',
      points: 0,
      correlationKey: 'unfinished-framework-template',
      source: 'content',
      description: 'The default framework title was not customised',
      evidence: title,
    });
  }

  if (/Get started by editing|Edit src\/App\.tsx|Edit app\/page\.tsx|Replace this with your own content/i.test(html)) {
    add({
      id: 'default-framework-copy',
      category: 'scaffold',
      direction: 'context',
      strength: 'moderate',
      points: 0,
      correlationKey: 'unfinished-framework-template',
      source: 'content',
      description: 'Verbatim starter-template instructions remain in the page',
    });
  }

  const imageSources = getTags(html, 'img')
    .map(tag => getAttribute(tag, 'src') ?? '')
    .filter(Boolean);
  const placeholderImages = imageSources.filter(source =>
    PLACEHOLDER_DOMAINS.some(domain => source.includes(domain)),
  ).length;
  if (placeholderImages > 0) {
    add({
      id: 'placeholder-images',
      category: 'scaffold',
      direction: 'context',
      strength: 'weak',
      points: 0,
      correlationKey: 'unfinished-content',
      source: 'markup',
      description: `${placeholderImages} placeholder image${placeholderImages === 1 ? '' : 's'} remain in the page`,
    });
  }

  const pageText = visibleText(html);
  if (/\blorem ipsum\b/i.test(pageText)) {
    add({
      id: 'lorem-ipsum',
      category: 'scaffold',
      direction: 'context',
      strength: 'weak',
      points: 0,
      correlationKey: 'unfinished-content',
      source: 'content',
      description: 'Placeholder lorem ipsum copy remains in the page',
    });
  }

  const hasNext = /__NEXT_DATA__|\/_next\/static/i.test(html);
  const hasVite = /\/@vite\/client|type=["']module["'][^>]+\/src\/main\.|\/assets\/[\w.-]+-[A-Za-z0-9_-]{6,}\.(?:js|css)/i.test(html);
  const hasFramework = hasNext || hasVite;
  const hasBaaS = /supabase\.(?:co|io)|firebase(?:app\.com|\.googleapis\.com)|convex\.(?:dev|cloud)|neon\.tech|turso\.(?:tech|io)|appwrite\.io/i.test(html);
  const shadcnMarkers = [
    /data-slot=/i,
    /data-radix-/i,
    /text-muted-foreground/i,
    /ring-offset-background/i,
    /border-border/i,
  ].filter(pattern => pattern.test(html)).length;
  const hasUiSystem = shadcnMarkers >= 2;
  const hasCloudHost = Boolean(
    headers['x-vercel-id'] ||
    headers['x-nf-request-id'] ||
    headers['x-railway-request-id'] ||
    headers['fly-request-id'] ||
    ['.vercel.app', '.netlify.app', '.railway.app', '.onrender.com', '.fly.dev'].some(suffix => hostname.endsWith(suffix)),
  );

  const stackParts = [hasFramework, hasBaaS, hasUiSystem, hasCloudHost].filter(Boolean).length;
  if (stackParts >= 4) {
    add({
      id: 'modern-scaffold-stack-four',
      category: 'stack',
      direction: 'context',
      strength: 'weak',
      points: 0,
      correlationKey: 'modern-stack-combination',
      source: 'markup',
      description: 'A modern framework, BaaS, component system, and cloud host appear together',
    });
  } else if (stackParts === 3) {
    add({
      id: 'modern-scaffold-stack-three',
      category: 'stack',
      direction: 'context',
      strength: 'weak',
      points: 0,
      correlationKey: 'modern-stack-combination',
      source: 'markup',
      description: 'Three common rapid-scaffolding stack layers appear together',
    });
  } else if (stackParts === 2 && hasFramework && (hasBaaS || hasUiSystem)) {
    add({
      id: 'modern-scaffold-stack-two',
      category: 'stack',
      direction: 'context',
      strength: 'weak',
      points: 0,
      correlationKey: 'modern-stack-combination',
      source: 'markup',
      description: 'Two common rapid-scaffolding stack layers appear together',
    });
  }

  // Marketing language is common across human and AI-written sites. It is only
  // a tiny corroborating signal when a stronger provenance/scaffold signal exists.
  const hasPriorSupport = signals.some(
    signal => signal.direction === 'supports' && signal.category === 'provenance',
  );
  if (hasPriorSupport) {
    const copyMatches = AI_COPY_PATTERNS.filter(pattern => pattern.test(pageText)).length;
    if (copyMatches >= 5) {
      add({
        id: 'generic-marketing-copy-heavy',
        category: 'content',
        direction: 'context',
        strength: 'weak',
        points: 0,
        correlationKey: 'generic-copy',
        source: 'content',
        description: `${copyMatches} generic AI-associated marketing phrases appear in the page copy`,
      });
    } else if (copyMatches >= 3) {
      add({
        id: 'generic-marketing-copy',
        category: 'content',
        direction: 'context',
        strength: 'weak',
        points: 0,
        correlationKey: 'generic-copy',
        source: 'content',
        description: `${copyMatches} generic AI-associated marketing phrases appear in the page copy`,
      });
    }
  }

  // Legacy technology is not proof of human authorship and does not subtract
  // from provenance evidence. It is retained only as explanatory context.
  if (!declaredGenerator && /\/wp-content\/|\/wp-includes\//i.test(html)) {
    add({
      id: 'wordpress-runtime',
      category: 'stack',
      direction: 'context',
      strength: 'weak',
      points: 0,
      correlationKey: 'legacy-cms',
      source: 'markup',
      description: 'WordPress runtime assets are present; this does not identify how the site was built',
    });
  }

  const provenance = cappedCategoryScore(signals, 'provenance');
  const scaffold = cappedCategoryScore(signals, 'scaffold');
  const stack = cappedCategoryScore(signals, 'stack');
  const content = cappedCategoryScore(signals, 'content');
  const conflicts = conflictScore(signals);

  const directSignal = signals.some(signal => signal.direction === 'supports' && signal.strength === 'direct');
  const strongProvenance = signals.some(
    signal => signal.direction === 'supports' && signal.category === 'provenance' && signal.points >= 45,
  );
  const conflictAttenuation = directSignal ? 0.2 : strongProvenance ? 0.45 : 1;
  const conflictPenalty = Math.round(conflicts * conflictAttenuation);
  const positiveTotal = provenance + scaffold + stack + content;
  const score = clamp(Math.round(positiveTotal - conflictPenalty), 0, 100);

  const supportingCategories = new Set(
    signals
      .filter(signal => signal.direction === 'supports' && signal.points > 0)
      .map(signal => signal.category),
  );

  const label = getVibeLabel(score, directSignal);
  let confidence: ConfidenceLevel = 'Low';
  if (directSignal) confidence = 'High';
  else if (strongProvenance || (score >= VIBE_SCORE_BANDS.strong && supportingCategories.size >= 2)) confidence = 'Medium';

  const breakdown: VibeScoreBreakdown = {
    provenance,
    scaffold,
    stack,
    content,
    conflictPenalty,
    total: score,
    independentSupportingCategories: supportingCategories.size,
    modelVersion: VIBE_MODEL_VERSION,
    scoreKind: 'evidence-index',
  };

  const limitations = [
    'This public-page scan cannot observe prompts, source history, developer understanding, or review quality.',
    'The evidence index is a versioned heuristic, not a probability or proof of authorship.',
    'Client-only code and blocked resources may hide relevant provenance signals.',
  ];

  return {
    score,
    label,
    confidence,
    reasons: signals.filter(signal => signal.direction === 'supports').map(signal => signal.description),
    signals,
    breakdown,
    declaredGenerator,
    limitations,
  };
}

export function getVibeLabel(score: number, hasDirectProvenance = false): VibeLabel {
  if (hasDirectProvenance) return 'Direct AI-builder provenance';
  if (score >= VIBE_SCORE_BANDS.strong) return 'Strong supporting evidence';
  if (score >= VIBE_SCORE_BANDS.limited) return 'Limited supporting evidence';
  return 'Inconclusive';
}
