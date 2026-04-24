import * as cheerio from 'cheerio';
import type { VibeLabel, ConfidenceLevel } from '@/types/analysis';

// ─────────────────────────────────────────────────────────────────────────────
// DETECTION MODEL — Five capped buckets + negative suppressor
//
//   directEvidence   (max 70) — near-proof fingerprints (generator tags, platform URLs)
//   stackPatterns    (max 45) — co-occurring AI-stack components (not individual picks)
//   artifactPatterns (max 22) — scaffolding never cleaned up (placeholders, default titles)
//   contentPatterns  (max 18) — AI copy / layout, gated on stack/direct evidence
//   softScore        (max 12) — low-confidence nudges, only when other evidence exists
//
//   negativeMultiplier (0.15–1.0) — suppresses legacy/hand-coded patterns
//
// Score → label:  ≥42 Likely Vibe-Coded  |  ≥22 Possibly  |  <22 Likely Hand-Coded
// ─────────────────────────────────────────────────────────────────────────────

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

// Patterns for generator meta tag and HTML comments only — kept tight to
// avoid false positives from site content that mentions these tools by name.
const AI_TOOLS: { pattern: RegExp; label: string }[] = [
  { pattern: /lovable/i,              label: 'Lovable' },
  { pattern: /v0\.dev|v0 by vercel/i, label: 'v0 by Vercel' },
  { pattern: /bolt\.new|stackblitz/i, label: 'Bolt / StackBlitz' },
  { pattern: /cursor\.sh/i,           label: 'Cursor' },
  { pattern: /windsurf\.ai/i,         label: 'Windsurf' },
  { pattern: /replit\.com/i,          label: 'Replit' },      // more specific than /replit/i
  { pattern: /webflow\.com/i,         label: 'Webflow' },     // more specific than /webflow/i
  { pattern: /framer\.com/i,          label: 'Framer' },
  { pattern: /squarespace/i,          label: 'Squarespace' },
  { pattern: /create\.t3\.gg/i,       label: 'T3 App' },
];

const CAPS = {
  directEvidence:   70,
  stackPatterns:    60,
  artifactPatterns: 22,
  contentPatterns:  18,
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

  // Parse hostname once — reused for both platform detection and hosting detection
  let urlHostname = '';
  if (url) { try { urlHostname = new URL(url).hostname; } catch { /* invalid URL */ } }

  // ══════════════════════════════════════════════════════════════════════════
  // BUCKET 1: Direct Evidence
  //
  // Near-deterministic proof that a specific AI tool generated the site.
  // Uses Math.max (not addition) so multiple signals from the same tool
  // don't double-count.
  // ══════════════════════════════════════════════════════════════════════════

  let directEvidence = 0;

  // Generator meta tag — explicit tool declaration
  const generator = $('meta[name="generator"]').attr('content') ?? '';
  for (const tool of AI_TOOLS) {
    if (tool.pattern.test(generator)) {
      directEvidence = Math.max(directEvidence, 65);
      reasons.push(`Generator meta tag identifies tool: ${tool.label}`);
      break;
    }
  }

  // HTML comments injected during AI code generation
  // Fixed regex: [\s\S]*? handles multiline comments correctly (old [^>]* broke on >)
  const comments = html.match(/<!--[\s\S]*?-->/g) ?? [];
  for (const c of comments) {
    for (const tool of AI_TOOLS) {
      if (tool.pattern.test(c)) {
        directEvidence = Math.max(directEvidence, 55);
        reasons.push(`${tool.label} fingerprint in HTML comment`);
        break;
      }
    }
  }

  // Platform URL — hosting on these domains is near-conclusive
  if (
    urlHostname.endsWith('.lovable.app') ||
    urlHostname.endsWith('.lovableproject.com') ||
    urlHostname.endsWith('.gptengineer.app')
  ) {
    directEvidence = Math.max(directEvidence, 65);
    reasons.push('Hosted on Lovable platform (*.lovable.app)');
  } else if (urlHostname.endsWith('.replit.app') || urlHostname.endsWith('.replit.dev')) {
    directEvidence = Math.max(directEvidence, 60);
    reasons.push('Hosted on Replit (*.replit.app)');
  } else if (urlHostname.includes('stackblitz') || urlHostname.endsWith('.bolt.new')) {
    directEvidence = Math.max(directEvidence, 60);
    reasons.push('Hosted on Bolt / StackBlitz');
  }

  // In-source platform fingerprints embedded in the HTML body
  if (
    html.includes('lovable.app') || html.includes('lovable.dev') ||
    html.includes('lovable-uploads') || html.includes('gptengineer') ||
    /built\s+with\s+lovable/i.test(html) || /edit\s+(in|with)\s+lovable/i.test(html)
  ) {
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
  // Measures how many of the 4 canonical AI-stack components co-exist.
  // The combination is the signal — not any individual choice.
  //
  //   1. JS framework  (Next.js / Vite)
  //   2. BaaS          (Supabase / Firebase / Convex / Neon / Turso)
  //   3. UI kit        (shadcn / Radix / AI CSS tokens / dense Tailwind)
  //   4. Cloud host    (Vercel / Netlify / Railway / Render / Fly)
  // ══════════════════════════════════════════════════════════════════════════

  const hasNextJs = html.includes('__NEXT_DATA__') || html.includes('/_next/static');
  const hasVite   =
    html.includes('/@vite/client') ||
    html.includes('data-vite-theme') ||
    html.includes('data-inject-first') ||
    /\/assets\/[a-zA-Z0-9_.-]+-[A-Za-z0-9_]{6,}\.(js|css)/.test(html) ||
    (html.includes('type="module"') && html.includes('/src/main.'));

  const hasSupabase   = html.includes('supabase.co') || html.includes('supabase.io') || html.includes('NEXT_PUBLIC_SUPABASE');
  const hasFirebase   = html.includes('firebaseapp.com') || html.includes('firebase.googleapis.com');
  // Modern BaaS options increasingly chosen by AI coding tools
  const hasModernBaaS =
    html.includes('convex.dev') || html.includes('convex.cloud') ||
    html.includes('neon.tech') ||
    html.includes('turso.tech') ||
    html.includes('appwrite.io');

  const hasClerk = html.includes('clerk.com') || html.includes('clerk.dev') || html.includes('__clerk_') || html.includes('clerk-js');

  // ── shadcn/ui detection via two complementary methods ──────────────────
  //
  // Method A: Radix runtime attributes (present in SSR HTML for rendered components)
  let shadcnPoints = 0;
  if (html.includes('data-radix-'))  shadcnPoints += 2;
  if (html.includes('cmdk-'))        shadcnPoints += 2;
  if (html.includes('@radix-ui'))    shadcnPoints += 2;
  if (html.includes('data-slot='))   shadcnPoints += 3; // shadcn v2 — exclusive marker
  if (html.includes('vaul-drawer'))  shadcnPoints += 2;

  // Method B: shadcn CSS variable class names in server-rendered HTML
  // These class names ONLY exist when shadcn's CSS variable system is configured.
  // Regular Tailwind uses concrete values (bg-gray-100, text-gray-900); shadcn
  // uses CSS-variable-backed names (bg-background, text-muted-foreground).
  // Crucially, these ARE present in the initial server-rendered HTML in class attrs,
  // making them reliable even when Radix runtime attributes haven't hydrated yet.
  if (html.includes('bg-background'))          shadcnPoints += 2;
  if (html.includes('text-muted-foreground'))   shadcnPoints += 3; // very shadcn-specific
  if (html.includes('border-border'))           shadcnPoints += 2;
  if (html.includes('bg-card'))                 shadcnPoints += 2;
  if (html.includes('ring-offset-background'))  shadcnPoints += 2; // shadcn focus token
  if (html.includes('text-foreground'))         shadcnPoints += 1;

  const hasShadcn = shadcnPoints >= 5;
  const hasRadix  = shadcnPoints >= 2;

  // shadcn CSS variable token names in inline <style> blocks
  const SHADCN_TOKENS = ['ring', 'radius', 'muted', 'card', 'popover', 'destructive'];
  const shadcnTokenHits = SHADCN_TOKENS.filter(t => new RegExp(`--${t}[\\s:;]`).test(html)).length;
  const hasAiCssTokens = shadcnTokenHits >= 3;

  const hasLucide       = /lucide-react|class="[^"]*\blucide-[^"]*"|data-lucide=/i.test(html);
  const hasFramerMotion = html.includes('framer-motion') || html.includes('data-framer-');

  // Tailwind density — ratio of class attributes that contain Tailwind patterns.
  // Uses class attribute count as denominator (not total tag count) to avoid
  // dilution from <meta>, <link>, <script> tags that never carry class attributes.
  const classAttrs   = (html.match(/\sclass(?:Name)?="/g) ?? []).length;
  const tailwindHits = classAttrs > 0
    ? (html.match(/class(?:Name)?="[^"]*(?:\bflex\b|\bgrid\b|\bp-\d|\bm-\d|\btext-\w+\b|\bbg-\w+\b|\bborder-\w+\b|\brounded(?:-\w+)?\b|\bshadow(?:-\w+)?\b|\bgap-\d)/g) ?? []).length
    : 0;
  const hasDenseTailwind = classAttrs > 10 && tailwindHits / classAttrs > 0.5;

  // Hosting detection — URL hostname is the most reliable signal
  const hasVercel  = !!headers['x-vercel-id'] || html.includes('vercel.app') || urlHostname.endsWith('.vercel.app');
  const hasNetlify = !!headers['x-nf-request-id'] || html.includes('netlify.app') || urlHostname.endsWith('.netlify.app');
  const hasRailway = html.includes('railway.app') || !!headers['x-railway-request-id'] || urlHostname.endsWith('.railway.app');
  const hasRender  = html.includes('onrender.com') || !!headers['rndr-id'] || urlHostname.endsWith('.onrender.com');
  const hasFly     = html.includes('fly.dev') || !!headers['fly-request-id'] || urlHostname.endsWith('.fly.dev');

  const hasFramework = hasNextJs || hasVite;
  const hasBaaS      = hasSupabase || hasFirebase || hasModernBaaS;
  const hasUiKit     = hasShadcn || hasRadix || hasAiCssTokens || (hasDenseTailwind && hasFramework);
  const hasCloudHost = hasVercel || hasNetlify || hasRailway || hasRender || hasFly;

  const coreStackCount = [hasFramework, hasBaaS, hasUiKit, hasCloudHost].filter(Boolean).length;

  let stackScore = 0;
  const stackReasons: string[] = [];

  if (coreStackCount >= 4) {
    stackScore = 55; // all four canonical components — high-confidence vibe stack
    stackReasons.push('Full AI vibe-code stack: JS framework + BaaS + shadcn/UI kit + cloud host');
  } else if (coreStackCount === 3) {
    stackScore = 25;
    const parts = [
      hasFramework && 'framework',
      hasBaaS      && 'BaaS',
      hasUiKit     && 'UI kit',
      hasCloudHost && 'host',
    ].filter(Boolean) as string[];
    stackReasons.push(`Strong AI stack combo (${parts.join(' + ')})`);
  } else if (coreStackCount === 2 && (hasBaaS || hasUiKit)) {
    stackScore = 12;
    stackReasons.push('Partial AI stack (framework or host + BaaS/UI kit)');
  }

  // Clerk auth — near-exclusive to AI-scaffolded apps (standalone bonus)
  if (hasClerk) {
    stackScore = Math.min(stackScore + 8, CAPS.stackPatterns);
    stackReasons.push('Clerk authentication (default auth layer in AI coding tools)');
  }

  // Lucide + Framer Motion co-present = textbook AI React UI choice
  if (hasLucide && hasFramerMotion && stackScore > 0) {
    stackScore = Math.min(stackScore + 4, CAPS.stackPatterns);
    stackReasons.push('Lucide icons + Framer Motion (default AI React UI combo)');
  }

  stackScore = Math.min(stackScore, CAPS.stackPatterns);
  if (stackScore > 0) reasons.push(...stackReasons);

  // ══════════════════════════════════════════════════════════════════════════
  // BUCKET 3: Artifact Patterns
  //
  // Evidence of scaffolding that was never cleaned up. Strong signals
  // regardless of stack — a real user would have replaced these.
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
  // Gating is graduated — content signals are weak alone and must be
  // supported by stack or direct evidence before they contribute:
  //   Full  (1.0) — directEvidence > 0 OR stackScore ≥ 14
  //   Partial (0.55) — stackScore ≥ 7 OR artifactScore ≥ 15
  //   None  (0)   — no supporting evidence
  // ══════════════════════════════════════════════════════════════════════════

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
  // Low-confidence nudges that help borderline cases. Each is too weak to
  // classify a site alone. Only fire when other positive evidence exists.
  // ══════════════════════════════════════════════════════════════════════════

  let softScore = 0;
  if (stackScore > 0 || directEvidence > 0) {
    // Geist font — Vercel's default font, auto-selected by AI Next.js scaffolds.
    // Check for font name, CSS variable, and CDN source.
    if (
      (html.includes('fonts.vercel.com') || html.includes('--font-geist') || html.includes('Geist')) &&
      hasNextJs
    ) {
      softScore += 4;
      reasons.push('Geist font (Vercel-default typography in AI Next.js scaffolds)');
    }
    // Vercel Analytics / Speed Insights — auto-injected by AI scaffold templates.
    // /_vercel/insights is the script path injected at the Vercel edge level.
    if (
      html.includes('va.vercel-scripts.com') ||
      html.includes('@vercel/analytics') ||
      html.includes('vitals.vercel-insights.com') ||
      html.includes('/_vercel/insights')
    ) {
      softScore += 4;
      reasons.push('Vercel Analytics (auto-added by AI Next.js scaffolds)');
    }
    // Lucide icons standalone (Framer Motion combo already scored in stackPatterns)
    if (hasLucide && !hasFramerMotion) {
      softScore += 4;
      reasons.push('Lucide React icons (default icon set in AI coding tools)');
    }
    // Sonner toast — default in shadcn / Lovable / Bolt stacks
    if (html.includes('[data-sonner') || html.includes('sonner-toast') || /["']sonner["']/.test(html)) {
      softScore += 3;
      reasons.push('Sonner toast library (default in AI-generated shadcn stack)');
    }
    // TanStack Query — AI default data-fetching choice for React apps
    if (html.includes('tanstack') || html.includes('react-query') || html.includes('QueryClient')) {
      softScore += 3;
      reasons.push('TanStack Query (AI default data-fetching library)');
    }
    // PostHog — very commonly added by AI coding tools as the default analytics
    if (html.includes('posthog.com') || html.includes('posthog-js') || html.includes('posthog.init')) {
      softScore += 3;
      reasons.push('PostHog analytics (common default in AI-generated apps)');
    }
    // data-testid attributes — AI tools auto-scaffold these on interactive elements
    const testIdCount = (html.match(/data-testid=/g) ?? []).length;
    if (testIdCount >= 5) {
      softScore += 3;
      reasons.push(`${testIdCount} data-testid attributes (AI tools auto-scaffold test IDs)`);
    }
    softScore = Math.min(softScore, 12);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NEGATIVE EVIDENCE
  //
  // Legacy / hand-coded patterns that contradict AI generation.
  // Applied as a multiplier on the total — suppresses rather than zeroes.
  // Strong direct evidence or artifacts prevent full suppression.
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

  // Don't let legacy signals fully crush strong direct evidence or artifact proof
  if (directEvidence >= 45 || artifactScore >= 18) {
    negativeMultiplier = Math.max(negativeMultiplier, 0.55);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL SCORE
  // ══════════════════════════════════════════════════════════════════════════

  const rawScore = directEvidence + stackScore + artifactScore + contentScore + softScore;
  const score = Math.min(100, Math.max(0, Math.round(rawScore * negativeMultiplier)));

  let confidence: ConfidenceLevel;
  if (directEvidence >= 50 || score >= 45) {
    confidence = 'High';
  } else if (score >= 22 || artifactScore >= 15 || stackScore >= 17) {
    confidence = 'Medium';
  } else {
    confidence = 'Low';
  }

  return { score, reasons, confidence };
}

export function getVibeLabel(score: number): VibeLabel {
  if (score >= 42) return 'Likely Vibe-Coded';
  if (score >= 22) return 'Possibly Vibe-Coded';
  return 'Likely Hand-Coded';
}
