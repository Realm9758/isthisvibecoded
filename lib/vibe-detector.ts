import * as cheerio from 'cheerio';
import type { VibeLabel, ConfidenceLevel } from '@/types/analysis';

// ─────────────────────────────────────────────────────────────────────────────
// DETECTION MODEL OVERVIEW
//
// Scoring is split into four capped buckets that are summed after gating:
//
//   directEvidence   (max 70) — near-proof: generator tags, platform URLs
//   stackPatterns    (max 25) — tech COMBOS, not individual libraries
//   artifactPatterns (max 22) — scaffolding left behind (placeholders, etc.)
//   contentPatterns  (max 15) — AI copy & structure, GATED on stack/direct
//
// A negativeMultiplier (0.15–1.0) then suppresses legacy/hand-coded sites.
//
// Gating rule: contentPatterns only contributes when there is either direct
// evidence OR a meaningful stack match (stackScore ≥ 14). This prevents a
// modern hand-coded Next.js + Tailwind + Vercel site from being flagged purely
// because its landing page copy uses common marketing phrases.
//
// Signal stacking from the old flat model caused false positives: a developer
// who chose Next.js (8) + Tailwind (6) + Vercel (8) + Supabase (20) + shadcn
// (10) accumulated 52 pts with zero AI-specific evidence. The new model treats
// those five choices as ONE cluster worth 22 pts at most.
// ─────────────────────────────────────────────────────────────────────────────

// ── AI marketing copy patterns ────────────────────────────────────────────────
const AI_COPY_PATTERNS: RegExp[] = [
  /transform\s+your\s+(workflow|business|life|world)/i,
  /get\s+started\s+(today|for\s+free|now|in\s+minutes)/i,
  /everything\s+you\s+need/i,
  /built\s+for\s+(the\s+modern|scale|teams)/i,
  /powerful\s+(features|tools|analytics)/i,
  /revolutionize\s+your/i,
  /unlock\s+(the\s+)?(full\s+)?potential/i,
  /seamless(ly)?\s+(integrate|experience|workflow)/i,
  /next[\s-]generation\s+(ai|platform|solution)/i,
  /streamline\s+your\s+(workflow|process)/i,
  /boost\s+your\s+(productivity|performance)/i,
  /all[\s-]in[\s-]one\s+(platform|solution|tool)/i,
  /the\s+(ultimate|best|perfect)\s+(platform|solution|tool)/i,
  /lorem\s+ipsum/i,
  /your\s+one[\s-]stop\s+/i,
  /industry[\s-]leading/i,
  /cutting[\s-]edge\s+(technology|ai|solution)/i,
  /supercharge\s+your/i,
  /elevate\s+your\s+(brand|business)/i,
  /harness\s+the\s+power/i,
  /join\s+(thousands|millions)\s+of/i,
  /start\s+your\s+(free\s+)?journey/i,
  /the\s+future\s+of\s+\w+/i,
  /works\s+for\s+(teams\s+of\s+all\s+sizes|everyone|startups)/i,
  /no\s+credit\s+card\s+required/i,
  /cancel\s+any\s+time/i,
  /trusted\s+by\s+\d/i,
  /contact\s+us\s+at\s+info@/i,
];

const PLACEHOLDER_DOMAINS = [
  'placeholder.com', 'via.placeholder', 'picsum.photos',
  'placehold.co', 'dummyimage.com', 'lorempixel.com',
];

// Known AI coding tool fingerprints — finding any of these is near-conclusive
const AI_TOOLS: { pattern: RegExp; label: string }[] = [
  { pattern: /lovable/i,              label: 'Lovable' },
  { pattern: /v0\.dev|v0 by vercel/i, label: 'v0 by Vercel' },
  { pattern: /bolt\.new|stackblitz/i, label: 'Bolt / StackBlitz' },
  { pattern: /cursor\.sh/i,           label: 'Cursor' },
  { pattern: /replit/i,               label: 'Replit' },
  { pattern: /webflow/i,              label: 'Webflow' },
  { pattern: /framer\.com/i,          label: 'Framer' },
  { pattern: /wix/i,                  label: 'Wix' },
  { pattern: /squarespace/i,          label: 'Squarespace' },
  { pattern: /create\.t3\.gg/i,       label: 'T3 App' },
];

// Per-bucket contribution caps — prevent any single category from dominating
const CAPS = {
  directEvidence:   70,
  stackPatterns:    25,
  artifactPatterns: 22,
  contentPatterns:  15,
};

// ── Main detector ─────────────────────────────────────────────────────────────
export function detectVibe(
  html: string,
  headers: Record<string, string> = {},
  url?: string,
): { score: number; reasons: string[]; confidence: ConfidenceLevel } {
  let $: ReturnType<typeof cheerio.load>;
  try {
    $ = cheerio.load(html);
  } catch {
    return { score: 30, reasons: ['Could not parse HTML'], confidence: 'Low' };
  }

  const reasons: string[] = [];

  // ══════════════════════════════════════════════════════════════════════════
  // BUCKET 1: Direct Evidence
  //
  // Near-deterministic proof that a specific AI tool generated the site.
  // Uses Math.max (not addition) to avoid double-counting the same tool.
  // ══════════════════════════════════════════════════════════════════════════

  let directEvidence = 0;

  // Generator meta tag — the most explicit signal possible
  const generator = $('meta[name="generator"]').attr('content') ?? '';
  for (const tool of AI_TOOLS) {
    if (tool.pattern.test(generator)) {
      directEvidence = Math.max(directEvidence, 65);
      reasons.push(`Generator meta tag identifies tool: ${tool.label}`);
      break;
    }
  }

  // HTML comments injected by AI tools during code generation
  const comments = html.match(/<!--[^>]*-->/g) ?? [];
  for (const c of comments) {
    for (const tool of AI_TOOLS) {
      if (tool.pattern.test(c)) {
        directEvidence = Math.max(directEvidence, 55);
        reasons.push(`${tool.label} fingerprint in HTML comment`);
        break;
      }
    }
  }

  // Platform URL — hosting on these domains is conclusive
  if (url) {
    try {
      const hostname = new URL(url).hostname;
      if (hostname.endsWith('.lovable.app') || hostname.endsWith('.lovableproject.com')) {
        directEvidence = Math.max(directEvidence, 65);
        reasons.push('Hosted on Lovable platform (*.lovable.app)');
      } else if (hostname.endsWith('.replit.app') || hostname.endsWith('.replit.dev')) {
        directEvidence = Math.max(directEvidence, 60);
        reasons.push('Hosted on Replit (*.replit.app)');
      } else if (hostname.includes('stackblitz') || hostname.endsWith('.bolt.new')) {
        directEvidence = Math.max(directEvidence, 60);
        reasons.push('Hosted on Bolt / StackBlitz');
      }
    } catch { /* invalid URL — skip */ }
  }

  // In-source platform fingerprints
  const lovableInSource =
    html.includes('lovable.app') ||
    html.includes('lovable.dev') ||
    html.includes('lovable-uploads') ||
    html.includes('gptengineer') ||
    /built\s+with\s+lovable/i.test(html) ||
    /edit\s+(in|with)\s+lovable/i.test(html);
  if (lovableInSource) {
    directEvidence = Math.max(directEvidence, 60);
    reasons.push('Lovable platform attribution found in source');
  }

  if (html.includes('v0.dev') || html.includes('vercel.com/templates')) {
    directEvidence = Math.max(directEvidence, 50);
    reasons.push('v0 by Vercel fingerprint found in source');
  }
  if (html.includes('bolt.new') || html.includes('stackblitz.io')) {
    directEvidence = Math.max(directEvidence, 50);
    reasons.push('Bolt / StackBlitz origin found in source');
  }
  if (html.includes('webflow.com') || html.includes('wf-form')) {
    directEvidence = Math.max(directEvidence, 45);
    reasons.push('Webflow site builder detected');
  }
  if (html.includes('framer.com/projects') || html.includes('framer.website')) {
    directEvidence = Math.max(directEvidence, 45);
    reasons.push('Framer site builder detected');
  }
  if (
    html.includes('replit.app') || html.includes('replit.com') ||
    headers['x-replit-user-id'] || headers['x-replit-user-name']
  ) {
    directEvidence = Math.max(directEvidence, 55);
    reasons.push('Replit platform fingerprint found');
  }

  directEvidence = Math.min(directEvidence, CAPS.directEvidence);

  // ══════════════════════════════════════════════════════════════════════════
  // BUCKET 2: Stack Patterns
  //
  // Measures how many of the 4 canonical AI-stack components co-exist:
  //   1. JS framework  (Next.js or Vite)
  //   2. BaaS          (Supabase or Firebase)
  //   3. UI kit        (shadcn / Radix / AI design tokens)
  //   4. Cloud host    (Vercel / Netlify / Railway / Render / Fly)
  //
  // A hand-coder might use one or two of these. AI tools almost always
  // generate all four together. That's the signal — the combo, not the parts.
  //
  // Clerk auth is a standalone bonus: it's the default auth layer in most
  // AI coding tools but uncommon in long-standing hand-coded projects.
  // ══════════════════════════════════════════════════════════════════════════

  const hasNextJs  = html.includes('__NEXT_DATA__') || html.includes('/_next/static');
  const hasVite    =
    html.includes('/@vite/client') ||
    html.includes('data-vite-theme') ||
    html.includes('data-inject-first') ||
    /\/assets\/[a-zA-Z0-9_.-]+-[A-Za-z0-9_]{6,}\.(js|css)/.test(html) ||
    (html.includes('type="module"') && html.includes('/src/main.'));

  const hasSupabase  = html.includes('supabase.co') || html.includes('supabase.io') || html.includes('NEXT_PUBLIC_SUPABASE');
  const hasFirebase  = html.includes('firebaseapp.com') || html.includes('firebase.googleapis.com');
  const hasClerk     = html.includes('clerk.com') || html.includes('clerk.dev') || html.includes('__clerk_') || html.includes('clerk-js');

  // shadcn/ui confirmation — score from multiple co-present Radix attributes
  let shadcnPoints = 0;
  if (html.includes('data-radix-'))  shadcnPoints += 2;
  if (html.includes('cmdk-'))        shadcnPoints += 2;
  if (html.includes('@radix-ui'))    shadcnPoints += 2;
  if (html.includes('data-slot='))   shadcnPoints += 3; // shadcn v2 marker
  if (html.includes('vaul-drawer'))  shadcnPoints += 2;
  const hasShadcn = shadcnPoints >= 5;
  const hasRadix  = shadcnPoints >= 2;

  // shadcn-exclusive CSS token names — a generic design system won't use
  // --ring, --radius, --muted, --popover, --destructive together
  const SHADCN_TOKENS = ['ring', 'radius', 'muted', 'card', 'popover', 'destructive'];
  const shadcnTokenHits = SHADCN_TOKENS.filter(t => new RegExp(`--${t}[\\s:;]`).test(html)).length;
  const hasAiCssTokens = shadcnTokenHits >= 3;

  const hasLucide       = /lucide-react|class="lucide lucide-/i.test(html);
  const hasFramerMotion = html.includes('framer-motion') || html.includes('data-framer-');

  // Tailwind utility density — not a standalone signal, but a meaningful reinforcement
  // when a framework + cloud host is already present. AI tools almost universally reach
  // for Tailwind; hand-coders are more likely to mix in custom CSS.
  const totalTags = (html.match(/<[a-z][a-z0-9]*/gi) ?? []).length;
  const tailwindHits = totalTags > 20
    ? (html.match(/class(?:Name)?="[^"]*(?:\bflex\b|\bgrid\b|\bp-\d|\bm-\d|\btext-\w|\bbg-\w|\bborder-\w|\brounded\b|\bshadow\b|\bgap-\d)/g) ?? []).length
    : 0;
  const hasDenseTailwind = totalTags > 20 && tailwindHits / totalTags > 0.35;

  const hasVercel  = !!headers['x-vercel-id'] || html.includes('vercel.app');
  const hasNetlify = !!headers['x-nf-request-id'] || html.includes('netlify.app');
  const hasRailway = html.includes('railway.app') || !!headers['x-railway-request-id'];
  const hasRender  = html.includes('onrender.com') || !!headers['rndr-id'];
  const hasFly     = html.includes('fly.dev') || !!headers['fly-request-id'];

  const hasFramework = hasNextJs || hasVite;
  const hasBaaS      = hasSupabase || hasFirebase;
  const hasUiKit     = hasShadcn || hasRadix || hasAiCssTokens;
  const hasCloudHost = hasVercel || hasNetlify || hasRailway || hasRender || hasFly;

  const coreStackCount = [hasFramework, hasBaaS, hasUiKit, hasCloudHost].filter(Boolean).length;

  let stackScore = 0;
  const stackReasons: string[] = [];

  if (coreStackCount >= 4) {
    stackScore = 22;
    stackReasons.push('Full AI vibe-code stack: JS framework + BaaS + shadcn/UI kit + cloud host');
  } else if (coreStackCount === 3) {
    stackScore = 14;
    const parts = [
      hasFramework && 'framework',
      hasBaaS && 'BaaS',
      hasUiKit && 'UI kit',
      hasCloudHost && 'host',
    ].filter(Boolean) as string[];
    stackReasons.push(`Strong AI stack combo (${parts.join(' + ')})`);
  } else if (coreStackCount === 2) {
    if (hasBaaS || hasUiKit) {
      // At least one component is meaningfully AI-correlated
      stackScore = 9;
      stackReasons.push('Partial AI stack (framework or host + BaaS/UI kit)');
    } else if (hasFramework && hasCloudHost && hasDenseTailwind) {
      // Next.js/Vite + Vercel/Netlify + heavy Tailwind — very common AI output
      // even without BaaS or shadcn (e.g. Cursor-generated landing pages)
      stackScore = 8;
      stackReasons.push('AI-typical combo: JS framework + cloud host + dense Tailwind');
    }
  }

  // Clerk is a standalone bonus: near-exclusive to AI-scaffolded apps
  if (hasClerk) {
    stackScore = Math.min(stackScore + 8, CAPS.stackPatterns);
    stackReasons.push('Clerk authentication (default auth layer in AI coding tools)');
  }

  // Lucide + Framer Motion together = textbook AI React UI choice
  if (hasLucide && hasFramerMotion && stackScore > 0) {
    stackScore = Math.min(stackScore + 4, CAPS.stackPatterns);
    stackReasons.push('Lucide icons + Framer Motion (default AI React UI combo)');
  }

  stackScore = Math.min(stackScore, CAPS.stackPatterns);
  if (stackScore > 0) reasons.push(...stackReasons);

  // ══════════════════════════════════════════════════════════════════════════
  // BUCKET 3: Artifact Patterns
  //
  // Evidence of scaffolding that was never cleaned up. These are strong
  // signals regardless of stack — a real user would have replaced them.
  // ══════════════════════════════════════════════════════════════════════════

  let artifactScore = 0;

  let placeholderImages = 0;
  for (const domain of PLACEHOLDER_DOMAINS) {
    placeholderImages += $(`img[src*="${domain}"]`).length;
  }
  if (placeholderImages > 0) {
    artifactScore += 20;
    reasons.push(`${placeholderImages} placeholder image(s) found — content never filled in`);
  }

  const title = $('title').text().trim();
  if (/^(Create Next App|My App|Next\.js App|Vite \+ React|React App|Your App Name|Vite App|SvelteKit App|T3 App)$/i.test(title)) {
    artifactScore += 18;
    reasons.push('Default framework template title (never customised)');
  }

  if (
    html.includes('Get started by editing') ||
    html.includes('Edit src/App.tsx') ||
    html.includes('Edit app/page.tsx') ||
    html.includes('Deploy your own') ||
    html.includes('Replace this with your own content')
  ) {
    artifactScore += 20;
    reasons.push('Verbatim framework template placeholder text found');
  }

  artifactScore = Math.min(artifactScore, CAPS.artifactPatterns);

  // ══════════════════════════════════════════════════════════════════════════
  // BUCKET 4: Content Patterns
  //
  // AI marketing copy and generic SaaS page structure.
  //
  // GATED: these signals are weak in isolation — many hand-coded SaaS sites
  // use the exact same phrases and layouts. Content only contributes when
  // there is already stack or direct evidence (stackScore ≥ 14 OR
  // directEvidence > 0). Without that gate, any polished landing page
  // would score as "Possibly Vibe-Coded".
  // ══════════════════════════════════════════════════════════════════════════

  // Gating is graduated, not binary:
  //   Full (1.0)  — direct evidence OR strong stack (≥14): content is well-supported
  //   Partial (0.55) — modest stack (≥7) OR strong artifacts (≥15): content reinforces
  //   None (0)  — no supporting evidence: content alone proves nothing
  let contentGate: number;
  if (directEvidence > 0 || stackScore >= 14) {
    contentGate = 1.0;
  } else if (stackScore >= 7 || artifactScore >= 15) {
    contentGate = 0.55;
  } else {
    contentGate = 0;
  }

  let contentScore = 0;

  if (contentGate > 0) {
    let aiCopyMatches = 0;
    for (const p of AI_COPY_PATTERNS) {
      if (p.test(html)) aiCopyMatches++;
    }
    if (aiCopyMatches >= 5) {
      contentScore += 12;
      reasons.push(`Heavy AI marketing copy (${aiCopyMatches} buzzword patterns)`);
    } else if (aiCopyMatches >= 3) {
      contentScore += 6;
      reasons.push(`Multiple AI copywriting patterns (${aiCopyMatches} matches)`);
    }

    const saasBlocks = [
      $('[class*="hero"], [id*="hero"], h1').length > 0,
      $('[class*="feature"], [id*="feature"]').length > 0,
      $('[class*="pricing"], [id*="pricing"]').length > 0,
      $('[class*="testimonial"], [class*="review"]').length > 0,
      $('[class*="faq"], [id*="faq"]').length > 0,
    ].filter(Boolean).length;
    if (saasBlocks >= 4) {
      contentScore += 8;
      reasons.push(`Textbook AI SaaS landing page structure (${saasBlocks}/5 sections)`);
    } else if (saasBlocks >= 3) {
      contentScore += 4;
      reasons.push(`Standard SaaS layout structure (${saasBlocks}/5 sections)`);
    }

    contentScore = Math.round(contentScore * contentGate);
  }

  contentScore = Math.min(contentScore, CAPS.contentPatterns);

  // ══════════════════════════════════════════════════════════════════════════
  // SOFT INDICATORS
  //
  // Low-confidence signals that nudge borderline cases. Each is too weak to
  // classify a site alone, but co-occurring with stack evidence they shift the
  // probability. Fires only when there is already some positive evidence.
  // Hard-capped at 10 to prevent inflating clean hand-coded sites.
  // ══════════════════════════════════════════════════════════════════════════

  let softScore = 0;
  if (stackScore > 0 || directEvidence > 0) {
    // Geist font — Vercel's own font, default in AI Next.js scaffolds
    if ((html.includes('fonts.vercel.com') || html.includes('Geist')) && hasNextJs) {
      softScore += 4;
      reasons.push('Geist font (Vercel-default typography in AI Next.js scaffolds)');
    }
    // Vercel Analytics / Speed Insights — auto-injected by AI scaffold templates
    if (html.includes('va.vercel-scripts.com') || html.includes('@vercel/analytics') || html.includes('vitals.vercel-insights.com')) {
      softScore += 4;
      reasons.push('Vercel Analytics (auto-added by AI Next.js scaffolds)');
    }
    // Lucide alone (Framer Motion combo already scored in stackPatterns above)
    if (hasLucide && !hasFramerMotion) {
      softScore += 4;
      reasons.push('Lucide React icons (default icon set in AI coding tools)');
    }
    // Sonner toast — default in shadcn/Lovable/Bolt apps
    if (html.includes('[data-sonner') || html.includes('sonner-toast') || /["']sonner["']/.test(html)) {
      softScore += 3;
      reasons.push('Sonner toast library (default in AI-generated shadcn stack)');
    }
    // TanStack Query — AI default data-fetching choice
    if (html.includes('tanstack') || html.includes('react-query') || html.includes('QueryClient')) {
      softScore += 3;
      reasons.push('TanStack Query (AI default data-fetching library)');
    }
    softScore = Math.min(softScore, 10);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NEGATIVE EVIDENCE
  //
  // Legacy / hand-coded patterns that contradict AI generation.
  // Applied as a multiplier on the final sum — suppresses rather than zeroes.
  // ══════════════════════════════════════════════════════════════════════════

  let negativeMultiplier = 1.0;

  if (html.includes('/wp-content/') || html.includes('/wp-includes/')) {
    negativeMultiplier = Math.min(negativeMultiplier, 0.15);
    reasons.push('WordPress CMS detected (not AI-generated)');
  }
  if (html.includes('jquery.min.js') || html.includes('jquery-') || html.includes('jQuery')) {
    negativeMultiplier = Math.min(negativeMultiplier, 0.35);
    reasons.push('jQuery detected (legacy hand-coded pattern)');
  }
  if (
    html.includes('bootstrap.min.css') || html.includes('bootstrap.bundle') ||
    html.includes('col-md-') || html.includes('col-sm-')
  ) {
    negativeMultiplier = Math.min(negativeMultiplier, 0.45);
    reasons.push('Bootstrap CSS detected (pre-AI toolchain)');
  }

  // Strong direct evidence or unambiguous artifacts should not be fully crushed by
  // legacy signals (e.g. a Lovable app that also loads jQuery from a CDN).
  if (directEvidence >= 45 || artifactScore >= 18) {
    negativeMultiplier = Math.max(negativeMultiplier, 0.55);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL SCORE
  // ══════════════════════════════════════════════════════════════════════════

  const rawScore = directEvidence + stackScore + artifactScore + contentScore + softScore;
  const score = Math.min(100, Math.max(0, Math.round(rawScore * negativeMultiplier)));

  let confidence: ConfidenceLevel;
  if (directEvidence >= 50 || score >= 65) {
    confidence = 'High';
  } else if (score >= 24 || artifactScore >= 15 || stackScore >= 14) {
    confidence = 'Medium';
  } else {
    confidence = 'Low';
  }

  return { score, reasons, confidence };
}

export function getVibeLabel(score: number): VibeLabel {
  if (score >= 55) return 'Likely Vibe-Coded';
  if (score >= 24) return 'Possibly Vibe-Coded';
  return 'Likely Hand-Coded';
}
