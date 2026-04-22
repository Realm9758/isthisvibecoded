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
  url?: string,
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

  // Clerk authentication — default auth in Cursor/Lovable/v0
  if (html.includes('clerk.com') || html.includes('clerk.dev') || html.includes('__clerk_') || html.includes('clerk-js')) {
    signals.push({ reason: 'Clerk authentication (default auth choice in most AI coding tools)', weight: 18, tag: 'clerk' });
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

  // Vite — AI default bundler for SPAs.
  // Detect via: dev-mode HMR client, node_modules path, data-vite-theme (Vite CSS injection attr),
  // or hashed /assets/ bundle filenames (Vite production output pattern).
  const hasViteDevMode = html.includes('/@vite/client') || html.includes('/node_modules/.vite/');
  const hasViteThemeAttr = html.includes('data-vite-theme') || html.includes('data-inject-first');
  const hasViteHashedBundle = /\/assets\/[a-zA-Z0-9_.-]+-[A-Za-z0-9_]{6,}\.(js|css)/.test(html);
  const hasViteModuleEntry = html.includes('type="module"') && (html.includes('/src/main.') || hasViteHashedBundle);
  const hasVite = hasViteDevMode || hasViteThemeAttr || hasViteHashedBundle || hasViteModuleEntry;
  if (hasVite) {
    signals.push({ reason: 'Vite build tool confirmed (AI default bundler for React/Vue SPAs)', weight: 10, tag: 'vite' });
  }

  // React SPA — empty root div is the hallmark of a client-rendered SPA
  const hasEmptyRootDiv = /<div\s+id=["'](root|app)["']\s*>\s*<\/div>/.test(html);
  const hasReactHelmet = html.includes('data-react-helmet');
  const hasReactSPA =
    html.includes('data-reactroot') ||
    hasEmptyRootDiv ||
    hasReactHelmet ||
    (html.includes('react-dom') && !hasNextJs);
  if (hasReactSPA) {
    signals.push({ reason: 'React SPA detected (client-side rendered, common AI-generated architecture)', weight: 8, tag: 'react' });
  }

  // React Helmet — AI tools add exhaustive meta tags via react-helmet by default
  if (hasReactHelmet) {
    signals.push({ reason: 'React Helmet metadata management (AI-generated SEO over-engineering)', weight: 8, tag: 'react_helmet' });
  }

  // Hashed asset bundles (Vite/CRA output) — single-module entry with content hash
  if (hasViteHashedBundle) {
    signals.push({ reason: 'Hashed asset bundle filenames (Vite build output — AI default SPA pattern)', weight: 8, tag: 'hashed_bundle' });
  }

  // Vue.js — common in Bolt/Cursor generated apps
  if (html.includes('__vue_app__') || html.includes('data-v-app') || html.includes('vue.runtime') || html.includes('createApp(')) {
    signals.push({ reason: 'Vue.js detected (increasingly common in AI-scaffolded apps)', weight: 8, tag: 'vue' });
  }

  // Stripe.js — AI default payment integration
  if (html.includes('js.stripe.com') || html.includes('stripe.com/v3')) {
    signals.push({ reason: 'Stripe.js payment integration (AI default monetization pattern)', weight: 10, tag: 'stripe' });
  }

  // PostHog — AI default analytics
  if (html.includes('posthog.com') || html.includes('posthog-js') || html.includes('posthog.init')) {
    signals.push({ reason: 'PostHog analytics (AI default product analytics integration)', weight: 8, tag: 'posthog' });
  }

  // Resend / React Email
  if (html.includes('resend.com') || html.includes('react-email')) {
    signals.push({ reason: 'Resend email service (AI default transactional email integration)', weight: 7, tag: 'resend' });
  }

  // TanStack Query / React Query
  if (html.includes('tanstack') || html.includes('react-query') || html.includes('QueryClient')) {
    signals.push({ reason: 'TanStack Query (AI default data-fetching library for React)', weight: 7, tag: 'tanstack' });
  }

  // Zustand
  if (html.includes('zustand') || (html.includes('createStore') && html.includes('useStore'))) {
    signals.push({ reason: 'Zustand state management (AI default for React global state)', weight: 7, tag: 'zustand' });
  }

  // Zod validation
  if (html.includes('zod') || html.includes('zodResolver') || html.includes('z.object(')) {
    signals.push({ reason: 'Zod schema validation (ubiquitous in AI-generated form handling)', weight: 6, tag: 'zod' });
  }

  // React Hook Form
  if (html.includes('react-hook-form') || html.includes('hookform/resolvers')) {
    signals.push({ reason: 'React Hook Form (AI default form library)', weight: 6, tag: 'rhf' });
  }

  // Express.js backend — AI tools almost universally reach for Express when needing a Node server
  if ((headers['x-powered-by'] ?? '').toLowerCase().includes('express')) {
    signals.push({ reason: 'Express.js backend (x-powered-by: Express — AI default Node.js server choice)', weight: 8, tag: 'express' });
  }

  // Sentry — AI tools default to Sentry for error monitoring
  if (html.includes('sentry.io') || html.includes('@sentry/') || html.includes('Sentry.init')) {
    signals.push({ reason: 'Sentry error monitoring (AI default error-tracking integration)', weight: 7, tag: 'sentry' });
  }

  // Hotjar / FullStory / LogRocket — AI "add session recording" additions
  if (html.includes('hotjar.com') || html.includes('static.hotjar') || html.includes('hj(')) {
    signals.push({ reason: 'Hotjar session recording (AI default UX analytics addition)', weight: 6, tag: 'session_rec' });
  }
  if (html.includes('fullstory.com') || html.includes('_fs_namespace') || html.includes('logrocket.com')) {
    signals.push({ reason: 'Session recording tool (AI agent "add analytics" addition)', weight: 6, tag: 'session_rec' });
  }

  // Live chat widgets — AI reliably adds chat when asked to "add support"
  if (html.includes('crisp.chat') || html.includes('client.crisp.chat') || html.includes('CRISP_WEBSITE_ID')) {
    signals.push({ reason: 'Crisp live chat (AI default "add customer support" integration)', weight: 8, tag: 'livechat' });
  }
  if (html.includes('intercom.io') || html.includes('widget.intercom.io') || html.includes('Intercom(')) {
    signals.push({ reason: 'Intercom live chat (AI default enterprise chat integration)', weight: 8, tag: 'livechat' });
  }
  if (html.includes('tawk.to') || html.includes('embed.tawk.to')) {
    signals.push({ reason: 'Tawk.to live chat (AI default free live chat integration)', weight: 7, tag: 'livechat' });
  }

  // Vercel Analytics / Speed Insights — injected by Next.js AI scaffolds
  if (html.includes('va.vercel-scripts.com') || html.includes('@vercel/analytics') || html.includes('vitals.vercel-insights.com') || html.includes('@vercel/speed-insights')) {
    signals.push({ reason: 'Vercel Analytics / Speed Insights (auto-added by AI Next.js scaffolds)', weight: 7, tag: 'vercel_analytics' });
  }

  // JSON-LD structured data — AI tools add SEO structured data by default
  const jsonLdCount = (html.match(/type=["']application\/ld\+json["']/g) ?? []).length;
  if (jsonLdCount >= 1) {
    signals.push({ reason: `JSON-LD structured data (${jsonLdCount} block${jsonLdCount > 1 ? 's' : ''} — AI default SEO over-engineering)`, weight: 6, tag: 'jsonld' });
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

  // Railway — common for AI-generated backends
  if (html.includes('railway.app') || headers['x-railway-edge'] || headers['x-railway-request-id']) {
    signals.push({ reason: 'Hosted on Railway (common AI-generated app deployment)', weight: 6, tag: 'railway' });
  }

  // Render
  if (html.includes('onrender.com') || headers['rndr-id'] || headers['x-render-origin-server']) {
    signals.push({ reason: 'Hosted on Render (common AI-generated app deployment)', weight: 5, tag: 'render' });
  }

  // Fly.io
  if (html.includes('fly.dev') || headers['fly-request-id']) {
    signals.push({ reason: 'Hosted on Fly.io (common AI-generated app deployment)', weight: 5, tag: 'fly' });
  }

  // Replit — URL-based detection (site is hosted on replit.app) or headers/HTML fingerprints
  const isReplit =
    (url && new URL(url).hostname.endsWith('.replit.app')) ||
    html.includes('replit.app') ||
    html.includes('replit.com') ||
    !!headers['x-replit-user-id'] ||
    !!headers['x-replit-user-name'];
  if (isReplit) {
    signals.push({ reason: 'Hosted on Replit (primary AI-assisted / vibe-coded deployment platform)', weight: 20, tag: 'replit' });
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

  // ── 10b. CSS custom properties — AI design system fingerprint ──────────────

  const cssVarMatches = (html.match(/--(?:primary|secondary|background|foreground|muted|accent|destructive|border|input|ring|card|popover|radius)[\s:;]/g) ?? []).length;
  if (cssVarMatches >= 6) {
    signals.push({ reason: `shadcn/Tailwind CSS variable design system (${cssVarMatches} tokens — exact AI scaffold pattern)`, weight: 14, tag: 'css_vars' });
  } else if (cssVarMatches >= 3) {
    signals.push({ reason: `CSS custom property naming matches AI-generated design system (${cssVarMatches} tokens)`, weight: 7, tag: 'css_vars' });
  }

  // data-testid — AI tools scaffold these by default
  const testIds = (html.match(/data-testid=/g) ?? []).length;
  if (testIds >= 4) {
    signals.push({ reason: `${testIds} data-testid attributes (AI tools auto-generate test scaffolding)`, weight: 7, tag: 'testid' });
  }

  // Generic loading / empty state copy
  const loadingMatches = (html.match(/loading\.\.\.|fetching data|please wait\.\.\.|no data found|no results found/gi) ?? []).length;
  if (loadingMatches >= 2) {
    signals.push({ reason: 'Generic loading/empty state text (AI default UX copy patterns)', weight: 5, tag: 'loading_text' });
  }

  // ── 11. Hand-coded negative signals (reduce score) ───────────────────────

  // jQuery = old hand-coded or WordPress, not AI generated React
  if (html.includes('jquery.min.js') || html.includes('jquery-') || html.includes('jQuery')) {
    signals.push({ reason: 'jQuery detected (strongly associated with hand-coded/legacy sites)', weight: -20, tag: 'handcoded' });
  }

  // Bootstrap (not shadcn/Tailwind) = hand-coded
  if (html.includes('bootstrap.min.css') || html.includes('bootstrap.bundle') || html.includes('col-md-') || html.includes('col-sm-')) {
    signals.push({ reason: 'Bootstrap CSS detected (legacy hand-coded pattern, not AI tooling)', weight: -18, tag: 'handcoded' });
  }

  // WordPress = hand-coded (or at least not AI-generated)
  if (html.includes('/wp-content/') || html.includes('/wp-includes/')) {
    signals.push({ reason: 'WordPress CMS detected (not AI-generated code)', weight: -25, tag: 'handcoded' });
  }

  // Pure CSS / no JS framework — only penalise if there are also no other AI signals
  const hasNoJsFramework = !hasNextJs && !hasReactSPA && !hasVite &&
    !html.includes('__vue_app__') && !html.includes('___gatsby') &&
    !html.includes('__remixContext') && !html.includes('/_app/immutable') &&
    !html.includes('angular');
  const positiveTagsSoFar = new Set(signals.filter(s => s.weight > 0).map(s => s.tag));
  if (hasNoJsFramework && positiveTagsSoFar.size < 2) {
    signals.push({ reason: 'No JS framework bundle detected (plain HTML/CSS)', weight: -12, tag: 'handcoded' });
  }

  // Very low Tailwind ratio with lots of custom CSS = hand-coded
  if (totalTags > 30 && tailwindCount / totalTags < 0.05 && html.includes('<style') && !positiveTagsSoFar.has('css_vars')) {
    signals.push({ reason: 'Custom CSS stylesheets with minimal utility classes (hand-crafted styling)', weight: -8, tag: 'handcoded' });
  }

  // ── 12. Compound bonuses (AI stack confirmed by multiple orthogonal signals) ─

  const tags = new Set(signals.filter(s => s.weight > 0).map(s => s.tag));

  // Core AI vibe-code combo: Next.js + BaaS + Tailwind/shadcn + cloud host
  const coreAiStack = [
    tags.has('nextjs'),
    tags.has('supabase') || tags.has('firebase'),
    tags.has('shadcn') || tags.has('tailwind'),
    tags.has('vercel') || tags.has('replit') || tags.has('netlify') || tags.has('railway'),
  ].filter(Boolean).length;
  if (coreAiStack >= 4) {
    signals.push({ reason: 'Full AI vibe-code stack confirmed: Next.js + BaaS + shadcn/Tailwind + cloud host', weight: 25, tag: 'compound' });
  } else if (coreAiStack >= 3) {
    signals.push({ reason: 'Strong AI stack combo detected (3/4 core AI tool indicators)', weight: 15, tag: 'compound' });
  }

  // Clerk + BaaS + framework = definitive AI full-stack combo
  if (tags.has('clerk') && (tags.has('supabase') || tags.has('firebase')) && (tags.has('nextjs') || tags.has('react') || tags.has('vite'))) {
    signals.push({ reason: 'Clerk + BaaS + React/Next.js — definitive AI-generated full-stack app pattern', weight: 20, tag: 'compound' });
  }

  // Vite + React + Tailwind/shadcn + cloud BaaS = non-Next AI SPA
  if ((tags.has('vite') || tags.has('react')) && (tags.has('shadcn') || tags.has('tailwind')) && (tags.has('supabase') || tags.has('firebase') || tags.has('clerk'))) {
    signals.push({ reason: 'Vite/React SPA + UI library + BaaS — AI-generated SPA stack', weight: 15, tag: 'compound' });
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

  // Modern tooling combo: Zod + React Hook Form + Tailwind = AI scaffolded form pattern
  if (tags.has('zod') && tags.has('rhf') && (tags.has('shadcn') || tags.has('tailwind'))) {
    signals.push({ reason: 'Zod + React Hook Form + Tailwind — AI default form validation stack', weight: 10, tag: 'compound' });
  }

  // CSS vars + shadcn/Tailwind = confirmed design system
  if (tags.has('css_vars') && (tags.has('shadcn') || tags.has('tailwind'))) {
    signals.push({ reason: 'CSS design tokens + shadcn/Tailwind — AI-generated design system confirmed', weight: 8, tag: 'compound' });
  }

  // Vite SPA + shadcn/css_vars + cloud hosting = definitive AI SPA deployment
  if (tags.has('vite') && (tags.has('css_vars') || tags.has('shadcn')) && (tags.has('replit') || tags.has('vercel') || tags.has('netlify') || tags.has('railway') || tags.has('render') || tags.has('fly'))) {
    signals.push({ reason: 'Vite SPA + shadcn design system + cloud host — definitive AI-deployed SPA', weight: 18, tag: 'compound' });
  }

  // React + Vite + hashed bundle + css_vars = AI-built production SPA (even without BaaS)
  if (tags.has('react') && tags.has('vite') && tags.has('hashed_bundle') && tags.has('css_vars')) {
    signals.push({ reason: 'React + Vite + hashed bundle + shadcn tokens — AI-assembled production SPA', weight: 15, tag: 'compound' });
  }

  // AI-generated SEO over-engineering: react-helmet + JSON-LD + full OG/Twitter meta
  if (tags.has('react_helmet') && tags.has('jsonld')) {
    signals.push({ reason: 'React Helmet + JSON-LD — AI over-engineered SEO meta stack', weight: 10, tag: 'compound' });
  }

  // Multiple third-party service stacking — AI agents add many integrations
  const thirdPartyCount = [
    tags.has('posthog') || tags.has('vercel_analytics'),
    tags.has('sentry'),
    tags.has('livechat'),
    tags.has('session_rec'),
    tags.has('stripe'),
  ].filter(Boolean).length;
  if (thirdPartyCount >= 3) {
    signals.push({ reason: `${thirdPartyCount} third-party service integrations (AI agents pile on services)`, weight: 12, tag: 'compound' });
  } else if (thirdPartyCount >= 2) {
    signals.push({ reason: 'Multiple third-party integrations co-present (AI agent service-adding pattern)', weight: 6, tag: 'compound' });
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
  if (score >= 50) return 'Likely Vibe-Coded';
  if (score >= 22) return 'Possibly Vibe-Coded';
  return 'Likely Hand-Coded';
}
