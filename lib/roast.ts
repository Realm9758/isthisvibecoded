import type { AnalysisResult } from '@/types/analysis';

const HIGH_VIBE: string[] = [
  "This screams '3AM hackathon, Cursor tab-completed the entire thing'",
  "ChatGPT architecture detected. The scaffolding is showing.",
  "Classic vibe-coded SaaS: hero section, generic CTA, Supabase auth, zero custom logic.",
  "If you ctrl+F 'Get started for free', you'll find it exactly where Claude put it.",
  "This site was probably described to an AI as 'make it look professional'.",
  "Every single component is from shadcn/ui. The human touch: changing the accent to purple.",
  "The Tailwind classes are so generic they look copy-pasted from a tutorial.",
  "There's more boilerplate here than actual product.",
  "Built with love, ChatGPT, and zero design decisions.",
  "This is what happens when 'ship fast' meets 'what's a content-security-policy'.",
  "GPT-4 left its fingerprints everywhere. It's not even trying to hide.",
  "The entire landing page is vibes — technically a product, spiritually a prompt.",
];

const MED_VIBE: string[] = [
  "Half hand-crafted, half 'hey Claude, can you add a pricing section'.",
  "Some parts were written by a human. The generic hero section wasn't.",
  "AI-assisted, but at least someone tried to customize it.",
  "Classic hybrid: human ideas, LLM execution, mixed results.",
  "The bones are human. The flesh is AI-generated.",
  "Someone touched this with a real keyboard at some point — probably.",
];

const LOW_VIBE: string[] = [
  "Impressively hand-crafted in a world of AI slop. Respect.",
  "An actual human wrote this. Rare.",
  "No significant AI fingerprints detected. Either very good at hiding it, or actually built it.",
  "This looks like it took more than 30 minutes to build.",
  "Custom code that makes AI-generated sites feel embarrassed.",
];

const SIGNAL_ROASTS: Partial<Record<string, string>> = {
  'Full AI vibe-code stack: JS framework + BaaS + shadcn/UI kit + cloud host':
    "The full starter-pack: Next.js, Supabase, shadcn, Vercel. Assembled by an AI in 11 seconds.",
  'Strong AI stack combo (framework + BaaS + host)':
    "Three out of four core AI stack components. Someone was *this* close to full vibe.",
  'Clerk authentication (default auth layer in AI coding tools)':
    "Clerk auth: because the AI needed to add login and didn't want to think about it.",
  'Default framework template title (never customised)':
    "They shipped without changing the page title. Living the 'Create Next App' life.",
  'Verbatim framework template placeholder text found':
    "This literally has the framework starter template text. It shipped. Unironically.",
  'Textbook AI SaaS landing page structure (4/5 sections)':
    "Hero → Features → Pricing → Testimonials. Every AI startup. Every time.",
  'Textbook AI SaaS landing page structure (5/5 sections)':
    "Hero → Features → Pricing → Testimonials → FAQ. The AI didn't leave a single section out.",
  'Heavy AI marketing copy (5 buzzword patterns)':
    "The copy reads like someone asked ChatGPT to 'make it sound more professional and inspiring'.",
  'Lovable platform attribution found in source':
    "Lovable.dev's fingerprints are everywhere. Vibe-coded and proud.",
  'Hosted on Lovable platform (*.lovable.app)':
    "Deployed straight to lovable.app. This is peak vibe-code infrastructure.",
  'Hosted on Replit (*.replit.app)':
    "Hosted on Replit — built and shipped from a chat window.",
  'v0 by Vercel fingerprint found in source':
    "v0.dev's DNA is all over this. Designed by prompt, deployed by Vercel.",
  'Bolt / StackBlitz origin found in source':
    "bolt.new strikes again. Born in a browser tab, died in production.",
};

function pick<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

export function generateRoasts(result: AnalysisResult): string[] {
  const roasts: string[] = [];

  if (result.vibe.score >= 70) {
    roasts.push(...pick(HIGH_VIBE, 2));
  } else if (result.vibe.score >= 35) {
    roasts.push(...pick(MED_VIBE, 1));
  } else {
    roasts.push(...pick(LOW_VIBE, 1));
  }

  for (const reason of result.vibe.reasons) {
    if (roasts.length >= 4) break;
    const roast = SIGNAL_ROASTS[reason];
    if (roast) roasts.push(roast);
  }

  if (result.security.score < 40 && roasts.length < 4) {
    roasts.push("The security score is underground. The AI forgot that 'Content-Security-Policy' exists.");
  }

  return roasts.slice(0, 4);
}
