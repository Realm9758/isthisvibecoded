import type { DeepScanResult, DeepFinding } from '@/types/deep-scan';

/**
 * Turns a report into a prompt you can paste into the tool that built the site.
 *
 * The framing is deliberate: every prompt asks the model to validate the
 * observation before changing code. These are bounded external probes, and a
 * model that trusts them blindly will happily rewrite a file over a false
 * positive.
 */

export type AiTool = 'cursor' | 'claude' | 'lovable' | 'v0' | 'bolt' | 'replit';

export const TOOLS: { id: AiTool; name: string; tagline: string }[] = [
  { id: 'cursor',  name: 'Cursor',  tagline: 'Full-stack, any stack' },
  { id: 'claude',  name: 'Claude',  tagline: 'Security-focused' },
  { id: 'lovable', name: 'Lovable', tagline: 'React and Supabase' },
  { id: 'v0',      name: 'v0',      tagline: 'Next.js and shadcn/ui' },
  { id: 'bolt',    name: 'Bolt',    tagline: 'React and Firebase' },
  { id: 'replit',  name: 'Replit',  tagline: 'Deploy-first, fast' },
];

const SUFFIX: Record<AiTool, string> = {
  cursor: `\n\n---\nGo through each issue one by one. For each:\n1. Identify the affected file or files\n2. Show the exact code change needed\n3. Explain why the fix works\n\nStart with the critical issues.`,
  claude: `\n\n---\nFor each potential finding:\n- Validate whether the evidence establishes a real attack vector\n- Show the exact code fix, before and after, only where warranted\n- Suggest related hardening\n\nPrioritise critical, then high, then medium. Be precise about file paths.`,
  lovable: `\n\n---\nI am using Lovable (React and Supabase). For each issue:\n1. Which file and component needs changing\n2. The updated code\n3. Any Supabase row level security policies that need updating\n\nFix critical issues first.`,
  v0: `\n\n---\nMy project uses the Next.js App Router with shadcn/ui. For each issue:\n1. Which route, component or middleware is affected\n2. The corrected code\n3. Any next.config or middleware changes needed`,
  bolt: `\n\n---\nI am using React, Vite and Firebase. For each issue:\n1. The affected component or Firebase rule\n2. The exact code fix\n3. Any Firebase security rule updates needed`,
  replit: `\n\n---\nI am hosting on Replit with Node and Express. For each issue:\n1. Which endpoint or middleware to change\n2. The corrected code\n3. Any environment variable or config changes\n\nKeep it simple.`,
};

const SEVERITY_ORDER: DeepFinding['severity'][] = ['critical', 'high', 'medium', 'low'];

export function buildFixPrompt(tool: AiTool, result: DeepScanResult): string {
  const { domain, summary, findings } = result;

  const actionable = findings
    .filter(finding => finding.severity !== 'info')
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  const lines = actionable
    .slice(0, 12)
    .map(f => [
      `[${f.severity.toUpperCase()}] ${f.title}`,
      `  Issue: ${f.description}`,
      f.url ? `  Affected URL: ${f.url}` : null,
      f.evidence ? `  Observed evidence: ${f.evidence}` : null,
      `  Fix: ${f.remediation}`,
    ].filter(Boolean).join('\n'))
    .join('\n\n');

  const scoreBlurb = [
    summary.score === null
      ? 'No grade: coverage was incomplete'
      : `Grade: ${summary.score}/100`,
    `${summary.critical} critical`,
    `${summary.high} high`,
    `${summary.medium} medium`,
  ].join(' · ');

  const header = `A bounded external scan of ${domain} reported ${actionable.length} potential finding${
    actionable.length === 1 ? '' : 's'
  }. Validate each observation against the actual application before changing code.\n\n${scoreBlurb}\n\n--- Potential findings ---\n\n${
    lines || 'No actionable findings were reported by the checks that ran.'
  }`;

  return header + SUFFIX[tool];
}
