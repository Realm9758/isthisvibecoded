import type { DeepScanResult } from '@/types/deep-scan';

/**
 * Roast Mode: the same findings, said bluntly.
 *
 * It is a toggle rather than the default because a security report has to be
 * usable by somebody having a bad day. The lines mock the state of the site,
 * never the person, and every one of them corresponds to something the scan
 * actually observed. A joke about a finding that is not there is just a lie
 * with a punchline.
 */

const CRITICAL = [
  'Someone can read your secrets from a browser. Not a clever someone. Any someone.',
  'This is not a vulnerability so much as a public invitation with your name on it.',
  'You did not get hacked. You published the instructions and waited.',
];

const HIGH = [
  'Nothing here needs a zero-day. It needs about four minutes and mild curiosity.',
  'The lock is on the door. The door is leaning against the wall next to the frame.',
  'A bored teenager with a browser is a credible threat model for this build.',
];

const MEDIUM = [
  'Nothing on fire. Several things quietly smoking.',
  'This would survive a casual look and lose an argument with anyone determined.',
  'Not dangerous today. Load-bearing assumptions are doing a lot of work, though.',
];

const CLEAN = [
  'Annoyingly fine. Nothing to mock in the checks that ran.',
  'Suspiciously tidy. The surface checks found nothing to hold against you.',
  'No notes. The fifteen checks that ran came back clean, which is rarer than you think.',
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

export function generateRoasts(result: DeepScanResult): string[] {
  const { critical, high, medium } = result.summary;
  const seed = `${result.domain}:${result.summary.score ?? 'withheld'}:${result.versions?.scoring ?? 'legacy'}`;

  const roasts = critical > 0
    ? pickStable(CRITICAL, seed, 2)
    : high > 0
      ? pickStable(HIGH, seed, 2)
      : medium > 0
        ? pickStable(MEDIUM, seed, 1)
        : pickStable(CLEAN, seed, 1);

  if (result.provenance?.builder) {
    roasts.push(`${result.provenance.builder} signed this one in the metadata. Credit where it is due, blame where it is earned.`);
  }

  // Findings are counted, never named. Roast Mode is a tone, not a second
  // channel for evidence, and the redacted report must not leak through it.
  if (critical > 0 && high > 0) {
    roasts.push(`${critical} critical and ${high} high. Pick a lane, ideally the one with fewer of both.`);
  }

  if (result.summary.score === null) {
    roasts.push('Your own firewall blocked part of the scan, so the grade is withheld. It is protecting you from us, at least.');
  }

  return roasts.slice(0, 4);
}
