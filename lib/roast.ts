import type { AnalysisResult } from '@/types/analysis';
import { VIBE_SCORE_BANDS } from './vibe-constants';

const STRONG_EVIDENCE = [
  'The page left a public builder nametag on its way to production.',
  'Strong provenance markers: the source is doing more confessing than detecting.',
  'This result has receipts, not just purple gradients and a hunch.',
];

const LIMITED_EVIDENCE = [
  'There is some builder-specific context here, but the jury is still reading the source.',
  'A provenance breadcrumb appeared. One breadcrumb is not the whole build history.',
  'Interesting public marker detected; prompts, review quality, and source history remain off-screen.',
];

const INCONCLUSIVE = [
  'The public HTML kept its origin story to itself. Mystery preserved.',
  'No scored provenance marker surfaced—human-built, AI-built, or simply well cleaned up remains unknown.',
  'The detector abstained. That is less dramatic, but much more honest.',
];

function stableIndex(seed: string, length: number, offset = 0): number {
  let hash = 2166136261;
  for (const char of `${seed}:${offset}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function pickStable(values: string[], seed: string, count: number): string[] {
  const picked: string[] = [];
  for (let offset = 0; picked.length < Math.min(count, values.length); offset++) {
    const value = values[stableIndex(seed, values.length, offset)];
    if (!picked.includes(value)) picked.push(value);
  }
  return picked;
}

export function generateRoasts(result: AnalysisResult): string[] {
  const seed = `${result.url}:${result.vibe.score}:${result.vibe.breakdown?.modelVersion ?? 'legacy'}`;
  const roasts = result.vibe.score >= VIBE_SCORE_BANDS.strong
    ? pickStable(STRONG_EVIDENCE, seed, 2)
    : result.vibe.score >= VIBE_SCORE_BANDS.limited
      ? pickStable(LIMITED_EVIDENCE, seed, 1)
      : pickStable(INCONCLUSIVE, seed, 1);

  if (result.vibe.declaredGenerator) {
    roasts.push(`${result.vibe.declaredGenerator} is declared in the page metadata—at least this one signed its work.`);
  }

  if (result.security.score < 40) {
    roasts.push('The response-header hardening needs attention; that says nothing about who wrote the app.');
  }

  return roasts.slice(0, 4);
}
