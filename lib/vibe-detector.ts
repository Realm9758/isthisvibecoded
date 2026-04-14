import * as cheerio from 'cheerio';
import type { VibeLabel, ConfidenceLevel } from '@/types/analysis';

interface VibeSignal {
  reason: string;
  weight: number;
  tag: string; // internal category for compound logic
}

// ── AI copy patterns ─────────────────────────────────────────────────────────

const AI_COPY_PATTERNS = [
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

// ── Tool generator fingerprints (definitive proof) ────────────────────────────

const GENERATOR_TOOLS: { pattern: RegExp; label: string }[] = [
  { pattern: /lovable/i,          label: 'Lovable' },
  { pattern: /v0\.dev|v0 by vercel/i, label: 'v0' },
  { pattern: /bolt\.new|stackblitz/i, label: 'Bolt / StackBlitz' },
  { pattern: /cursor\.sh/i,       label: 'Cursor' },
  { pattern: /replit/i,           label: 'Replit' },
  { pattern: /webflow/i,          label: 'Webflow' },
  { pattern: /framer\.com/i,      label: 'Framer' },
  { pattern: /wix/i,              label: 'Wix' },
  { pattern: /squarespace/i,      label: 'Squarespace' },
  { pattern: /create\.t3\.gg/i,   label: 'T3 App (AI-default scaffold)' },
  { pattern: /shadcn\/ui/i,       label: 'shadcn/ui scaffold' },
];

// ── Main detector ─────────────────────────────────────────────────────────────

export function detectVibe(
  html: string,
  headers: Record<string, string> = {},
): { score: number; reasons: string[]; confidence: ConfidenceLevel } {
  const signals: VibeSignal[] = [];

  let $: ReturnType<typeof cheerio.load>;
  try {
    $ = cheerio.load(html);
  } catch {
    return { score: 30, reasons: ['Could not parse HTML'], confidence: 'Low' };
  }

  // ── 1. Definitive tool fingerprints (generator meta / html comments / copyright) ─

  // generator meta tag
  const generator = $('meta[name="generator"]').attr('content') ?? '';
  for (const tool of GENERATOR_TOOLS) {
    if (tool.pattern.test(generator)) {
      signals.push({ reason: `Generator meta tag identifies tool: ${tool.label}`, weight: 60, tag: 'generator' });
      break;
    }
  }

  // HTML comments that AI tools inject
  const commentMatches = html.match(/<!--[^>]*-->/g) ?? [];
  for (const c of commentMatches) {
    for (const tool of GENERATOR_TOOLS) {
      if (tool.pattern.test(c)) {
        signals.push({ reason: `${tool.label} fingerprint found in HTML comment`, weight: 50, tag: 'generator' });
        break;
      }
    }
  }

  // Lovable injects a specific attribution link
  if (html.includes('lovable.dev') || html.includes('lovable-uploads') || html.includes('gptengineer')) {
    signals.push({ reason: 'Lovable platform attribution found in source', weight: 55, tag: 'generator' });
  }

  // v0 by Vercel
  if (html.includes('v0.dev') || html.includes('vercel.com/templates')) {
    signals.push({ reason: 'v0 by Vercel fingerprint found in source', weight: 50, tag: 'generator' });
  }

  // Bolt / StackBlitz
  if (html.includes('bolt.new') || html.includes('stackblitz.io')) {
    signals.push({ reason: 'Bolt / StackBlitz origin found in source', weight: 50, tag: 'generator' });
  }

  // Webflow
  if (html.includes('webflow.com') || html.includes('wf-form')) {
    signals.push({ reason: 'Webflow site builder detected', weight: 45, tag: 'generator' });
  }

  // Framer-built site (distinct from Framer Motion library)
  if (html.includes('framer.com/projects') || html.includes('framer.website')) {
    signals.push({ reason: 'Framer site builder detected', weight: 45, tag: 'generator' });
  }

  // ── 2. Template / starter scaffold fingerprints ───────────────────────────

  const title = $('title').text().trim();
  if (/^(Create Next App|My App|Next\.js App|Vite \+ React|React App|Your App Name|Vite App|SvelteKit App|T3 App)$/i.test(title)) {
    signals.push({ reason: 'Default framework template title (never customised)', weight: 35, tag: 'template' });
  }

  if (
    html.includes('Get started by editing') ||
    html.includes('Edit src/App.tsx') ||
    html.includes('Edit app/page.tsx') ||
    html.includes('Deploy your own') ||
    html.includes('Replace this with your own content')
  ) {
    signals.push({ reason: 'Verbatim framework template placeholder text found', weight: 40, tag: 'template' });
  }

  // ── 3. AI-default tech stack signals ─────────────────────────────────────

  // Supabase — #1 AI-codegen BaaS choice
  if (html.includes('supabase.co') || html.includes('supabase.io') || html.includes('NEXT_PUBLIC_SUPABASE')) {
    signals.push({ reason: 'Supabase BaaS detected (dominant choice in AI codegen)', weight: 20, tag: 'supabase' });
  }

  // Firebase — common in Bolt/older templates
  if (html.includes('firebaseapp.com') || html.includes('firebase.googleapis.com')) {
    signals.push({ reason: 'Firebase detected (common AI codegen BaaS)', weight: 16, tag: 'firebase' });
  }

  // Next.js
  const hasNextJs = html.includes('__NEXT_DATA__') || html.includes('/_next/static');
  if (hasNextJs) {
    signals.push({ reason: 'Next.js detected (overwhelmingly common AI scaffold framework)', weight: 8, tag: 'nextjs' });
  }

  // Large number of Next.js JS chunks = AI-generated (hand-coded apps usually have fewer, smaller bundles)
  const nextChunks = (html.match(/\/_next\/static\/chunks\//g) ?? []).length;
  if (nextChunks > 8) {
    signals.push({ reason: `${nextChunks} Next.js JS chunks loaded (typical of scaffold-generated apps)`, weight: 10, tag: 'nextjs_chunks' });
  }

  // ── 4. shadcn / Radix UI — the AI component kit ──────────────────────────

  let shadcnScore = 0;
  if (html.includes('data-radix-'))      shadcnScore += 2;
  if (html.includes('cmdk-'))            shadcnScore += 2;
  if (html.includes('@radix-ui'))        shadcnScore += 2;
  if (html.includes('data-slot='))       shadcnScore += 3; // shadcn v2 specific
  if (html.includes('vaul-drawer'))      shadcnScore += 2;
  if (html.includes('sonner'))           shadcnScore += 1; // toast lib, default in shadcn
  if (html.includes('react-hot-toast')) shadcnScore += 1;
  if (/class="[^"]*lucide[^"]*"/.test(html)) shadcnScore += 2; // Lucide icons — AI default

  if (shadcnScore >= 5) {
    signals.push({ reason: 'shadcn/ui component library confirmed (default AI assistant scaffold)', weight: 18, tag: 'shadcn' });
  } else if (shadcnScore >= 2) {
    signals.push({ reason: 'Radix UI / shadcn components detected', weight: 10, tag: 'shadcn' });
  }

  // Lucide icons standalone — very correlated with AI-generated React apps
  if (/lucide-react|class="lucide lucide-/i.test(html)) {
    signals.push({ reason: 'Lucide icons detected (default icon set in most AI coding tools)', weight: 10, tag: 'lucide' });
  }

  // Framer Motion (library, not builder) — AI tools default to this for animation
  if (html.includes('framer-motion') || html.includes('framermotion') || html.includes('data-framer-')) {
    signals.push({ reason: 'Framer Motion animation library (default in AI-generated React apps)', weight: 10, tag: 'framer_motion' });
  }

  // Sonner toast notifications
  if (html.includes('[data-sonner') || html.includes('sonner-toast')) {
    signals.push({ reason: 'Sonner toast library (default in shadcn/Lovable stack)', weight: 8, tag: 'sonner' });
  }

  // Geist font — Vercel's own font, injected by default in many AI tools
  if (html.includes('fonts.vercel.com') || html.includes('Geist') || html.includes('geist')) {
    signals.push({ reason: 'Geist font (Vercel default, common in AI-scaffolded Next.js)', weight: 8, tag: 'geist' });
  }

  // Inter font loaded via Google Fonts / next/font — AI default typography
  if (/fonts\.googleapis\.com.*Inter|next\/font.*inter/i.test(html)) {
    signals.push({ reason: 'Inter font (ubiquitous default in AI-generated design systems)', weight: 5, tag: 'inter' });
  }

  // ── 5. Hosting platform signals ───────────────────────────────────────────

  const isVercel = !!headers['x-vercel-id'] || html.includes('vercel.app');
  if (isVercel) {
    signals.push({ reason: 'Hosted on Vercel (most popular AI-generated app deployment platform)', weight: 8, tag: 'vercel' });
  }

  const isNetlify = !!headers['x-nf-request-id'] || html.includes('netlify.app');
  if (isNetlify) {
    signals.push({ reason: 'Hosted on Netlify (common AI-generated site deployment)', weight: 5, tag: 'netlify' });
  }

  // ── 6. Placeholder / unfinished content ───────────────────────────────────

  let placeholderImages = 0;
  for (const domain of PLACEHOLDER_DOMAINS) {
    placeholderImages += $(`img[src*="${domain}"]`).length;
  }
  if (placeholderImages > 0) {
    signals.push({ reason: `${placeholderImages} placeholder image(s) — content was never filled in`, weight: 22, tag: 'placeholder' });
  }

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(' ').filter(Boolean).length;
  if (wordCount < 60 && html.length > 8000) {
    signals.push({ reason: 'Tiny visible text relative to large codebase (common in scaffold shells)', weight: 10, tag: 'sparse' });
  }

  // ── 7. AI-generated copy patterns ─────────────────────────────────────────

  let aiCopyMatches = 0;
  for (const pattern of AI_COPY_PATTERNS) {
    if (pattern.test(html)) aiCopyMatches++;
  }
  if (aiCopyMatches >= 5) {
    signals.push({ reason: `Heavy AI marketing copy (${aiCopyMatches} pattern matches — buzzword-dense)`, weight: 25, tag: 'aicopy' });
  } else if (aiCopyMatches >= 3) {
    signals.push({ reason: `Multiple AI copywriting patterns (${aiCopyMatches} matches)`, weight: 15, tag: 'aicopy' });
  } else if (aiCopyMatches >= 1) {
    signals.push({ reason: `Generic copy pattern detected (${aiCopyMatches} match)`, weight: 6, tag: 'aicopy' });
  }

  // ── 8. Generic SaaS structure ─────────────────────────────────────────────

  const hasHero        = $('[class*="hero"], [id*="hero"], h1').length > 0;
  const hasFeatures    = $('[class*="feature"], [id*="feature"]').length > 0;
  const hasPricing     = $('[class*="pricing"], [id*="pricing"]').length > 0;
  const hasTestimonials = $('[class*="testimonial"], [class*="review"]').length > 0;
  const hasFAQ         = $('[class*="faq"], [id*="faq"]').length > 0;
  const saasBlockCount = [hasHero, hasFeatures, hasPricing, hasTestimonials, hasFAQ].filter(Boolean).length;
  if (saasBlockCount >= 4) {
    signals.push({ reason: `Textbook AI SaaS landing page structure (${saasBlockCount}/5 sections: hero/features/pricing/testimonials/FAQ)`, weight: 18, tag: 'saas_structure' });
  } else if (saasBlockCount >= 3) {
    signals.push({ reason: `Generic SaaS template structure (${saasBlockCount} standard sections)`, weight: 10, tag: 'saas_structure' });
  }

  const navTexts = $('nav a, header a, [role="navigation"] a')
    .map((_, el) => $(el).text().trim().toLowerCase()).get().filter(Boolean);
  const genericNavItems = ['home', 'about', 'features', 'pricing', 'contact', 'blog', 'docs', 'sign in', 'login', 'get started', 'dashboard'];
  const genericNavCount = navTexts.filter(t => genericNavItems.some(g => t.includes(g))).length;
  if (navTexts.length > 0 && genericNavCount >= 4) {
    signals.push({ reason: 'Boilerplate SaaS navigation (Features / Pricing / Docs / Sign In)', weight: 8, tag: 'generic_nav' });
  }

  const buttonTexts = $('button, a[class*="btn"], a[class*="button"], [role="button"]')
    .map((_, el) => $(el).text().trim().toLowerCase()).get();
  const genericCTAs = ['get started', 'try for free', 'start free trial', 'sign up free', 'start now', 'get started for free', 'try it free'];
  const ctaCount = buttonTexts.filter(t => genericCTAs.some(g => t.includes(g))).length;
  if (ctaCount >= 2) {
    signals.push({ reason: `${ctaCount} generic CTA buttons (AI default call-to-action copy)`, weight: 10, tag: 'generic_cta' });
  }

  // ── 9. Tailwind class density ─────────────────────────────────────────────

  const tailwindCount = (html.match(/class(?:Name)?="[^"]*(?:flex|grid|p-\d|m-\d|text-\w|bg-\w|border-\w|rounded|shadow|gap-)[^"]*"/g) ?? []).length;
  const totalTags = (html.match(/<[a-z][a-z0-9]*/gi) ?? []).length;
  if (totalTags > 20) {
    const ratio = tailwindCount / totalTags;
    if (ratio > 0.75) {
      signals.push({ reason: 'Extreme Tailwind CSS density (utility-first generated layout)', weight: 12, tag: 'tailwind' });
    } else if (ratio > 0.5) {
      signals.push({ reason: 'High Tailwind CSS usage consistent with scaffold generation', weight: 6, tag: 'tailwind' });
    }
  }

  // ── 10. Missing / generic meta description ────────────────────────────────

  const metaDesc = $('meta[name="description"]').attr('content') ?? '';
  if (!metaDesc) {
    signals.push({ reason: 'No meta description (frequently skipped in AI-generated projects)', weight: 5, tag: 'meta' });
  } else if (/^(A|An|The)\s+\w+\s+(app|application|website|platform)\.?$/i.test(metaDesc)) {
    signals.push({ reason: 'One-liner generic meta description (AI placeholder)', weight: 8, tag: 'meta' });
  }

  // ── 11. Hand-coded negative signals (reduce score) ───────────────────────

  const hasCustomDomain = !html.includes('vercel.app') && !html.includes('netlify.app') &&
    !html.includes('repl.co') && !html.includes('glitch.me');

  // jQuery = old hand-coded or WordPress, not AI generated React
  if (html.includes('jquery.min.js') || html.includes('jquery-') || html.includes('jQuery')) {
    signals.push({ reason: 'jQuery detected (strongly associated with hand-coded/legacy sites)', weight: -20, tag: 'handcoded' });
  }

  // Bootstrap (not shadcn/Tailwind) = hand-coded
  if (html.includes('bootstrap.min.css') || html.includes('bootstrap.bundle') || html.includes('col-md-') || html.includes('col-sm-')) {
    signals.push({ reason: 'Bootstrap CSS detected (legacy hand-coded pattern, not AI tooling)', weight: -18, tag: 'handcoded' });
  }

  // Pure CSS / no JS framework = hand-coded
  const hasNoJsFramework = !hasNextJs &&
    !html.includes('data-reactroot') && !html.includes('react-dom') &&
    !html.includes('__vue_app__') && !html.includes('___gatsby') &&
    !html.includes('__remixContext') && !html.includes('/_app/immutable');
  if (hasNoJsFramework && !html.includes('angular')) {
    signals.push({ reason: 'No JS framework bundle detected (plain HTML/CSS)', weight: -15, tag: 'handcoded' });
  }

  // WordPress = hand-coded (or at least not AI-generated)
  if (html.includes('/wp-content/') || html.includes('/wp-includes/')) {
    signals.push({ reason: 'WordPress CMS detected (not AI-generated code)', weight: -25, tag: 'handcoded' });
  }

  // Very low Tailwind ratio with lots of custom CSS = hand-coded
  if (totalTags > 30 && tailwindCount / totalTags < 0.05 && html.includes('<style')) {
    signals.push({ reason: 'Custom CSS stylesheets with minimal utility classes (hand-crafted styling)', weight: -10, tag: 'handcoded' });
  }

  // ── 12. Compound bonuses (AI stack confirmed by multiple orthogonal signals) ─

  const tags = new Set(signals.filter(s => s.weight > 0).map(s => s.tag));

  // Core AI vibe-code combo: Next.js + Supabase/Firebase + Tailwind/shadcn + Vercel
  const coreAiStack = [
    tags.has('nextjs'),
    tags.has('supabase') || tags.has('firebase'),
    tags.has('shadcn') || tags.has('tailwind'),
    tags.has('vercel'),
  ].filter(Boolean).length;
  if (coreAiStack >= 4) {
    signals.push({ reason: 'Full AI vibe-code stack confirmed: Next.js + BaaS + shadcn/Tailwind + Vercel', weight: 25, tag: 'compound' });
  } else if (coreAiStack >= 3) {
    signals.push({ reason: 'Strong AI stack combo detected (3/4 core AI tool indicators)', weight: 15, tag: 'compound' });
  }

  // Content combo: AI copy + SaaS structure + generic CTAs
  const contentSignals = [
    tags.has('aicopy'),
    tags.has('saas_structure'),
    tags.has('generic_cta'),
    tags.has('generic_nav'),
  ].filter(Boolean).length;
  if (contentSignals >= 3) {
    signals.push({ reason: 'AI content fingerprint: marketing copy + SaaS layout + generic CTAs all co-present', weight: 12, tag: 'compound' });
  }

  // UI library combo: shadcn + Lucide + Framer Motion = textbook AI React app
  if (tags.has('shadcn') && tags.has('lucide') && tags.has('framer_motion')) {
    signals.push({ reason: 'shadcn + Lucide + Framer Motion — standard AI assistant React stack', weight: 15, tag: 'compound' });
  }

  // ── Calculate final score ─────────────────────────────────────────────────

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = Math.min(100, Math.max(0, Math.round(totalWeight)));

  const positiveSignals = signals.filter(s => s.weight > 0);
  let confidence: ConfidenceLevel;
  if (positiveSignals.length >= 5 || totalWeight >= 55) {
    confidence = 'High';
  } else if (positiveSignals.length >= 3 || totalWeight >= 28) {
    confidence = 'Medium';
  } else {
    confidence = 'Low';
  }

  const reasons = signals.filter(s => s.weight > 0).map(s => s.reason);
  return { score, reasons, confidence };
}

export function getVibeLabel(score: number): VibeLabel {
  if (score >= 60) return 'Likely Vibe-Coded';
  if (score >= 28) return 'Possibly Vibe-Coded';
  return 'Likely Hand-Coded';
}
