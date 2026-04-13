import * as cheerio from 'cheerio';
import type { VibeLabel, ConfidenceLevel } from '@/types/analysis';

interface VibeSignal {
  reason: string;
  weight: number;
}

const AI_COPY_PATTERNS = [
  /transform\s+your\s+(workflow|business|life|world)/i,
  /get\s+started\s+(today|for\s+free|now|in\s+minutes)/i,
  /everything\s+you\s+need/i,
  /built\s+for\s+(the\s+modern|scale|teams)/i,
  /powerful\s+(features|tools|analytics)/i,
  /welcome\s+to\s+(my|our|the)\s+\w+/i,
  /revolutionize\s+your/i,
  /unlock\s+(the\s+)?(full\s+)?potential/i,
  /seamless(ly)?\s+(integrate|experience|workflow)/i,
  /next[\s-]generation\s+(ai|platform|solution)/i,
  /streamline\s+your\s+(workflow|process)/i,
  /boost\s+your\s+(productivity|performance)/i,
  /all[\s-]in[\s-]one\s+(platform|solution|tool)/i,
  /the\s+(ultimate|best|perfect)\s+(platform|solution|tool)/i,
  /lorem\s+ipsum/i,
  /contact\s+us\s+at\s+info@/i,
  /your\s+one[\s-]stop\s+/i,
  /industry[\s-]leading/i,
  /cutting[\s-]edge\s+(technology|ai|solution)/i,
  /supercharge\s+your/i,
  /elevate\s+your\s+(brand|business)/i,
  /harness\s+the\s+power/i,
  /make\s+it\s+happen/i,
];

const GENERIC_PLACEHOLDER_DOMAINS = ['placeholder.com', 'via.placeholder', 'picsum.photos', 'placehold.co', 'dummyimage.com', 'lorempixel.com'];

export function detectVibe(html: string): { score: number; reasons: string[]; confidence: ConfidenceLevel } {
  const signals: VibeSignal[] = [];
  let $ : ReturnType<typeof cheerio.load>;

  try {
    $ = cheerio.load(html);
  } catch {
    return { score: 30, reasons: ['Could not parse HTML'], confidence: 'Low' };
  }

  // — Template fingerprints (very strong) —
  const title = $('title').text().trim();
  if (/^(Create Next App|My App|Next\.js App|Vite \+ React|React App|Your App Name)$/i.test(title)) {
    signals.push({ reason: 'Default framework template title detected', weight: 30 });
  }

  if (html.includes('Get started by editing') || html.includes('Deploy your own') || html.includes('Edit src/App.tsx')) {
    signals.push({ reason: 'Verbatim framework template starter text found', weight: 35 });
  }

  // — Backend/infra defaults —
  if (html.includes('supabase.co') || html.includes('NEXT_PUBLIC_SUPABASE')) {
    signals.push({ reason: 'Supabase integration detected (most common AI codegen choice)', weight: 20 });
  }
  if (html.includes('firebaseapp.com') || html.includes('firebase.googleapis.com')) {
    signals.push({ reason: 'Firebase defaults detected in page source', weight: 18 });
  }
  if (html.includes('__NEXT_DATA__')) {
    signals.push({ reason: 'Next.js framework detected (overwhelmingly common in AI-generated sites)', weight: 5 });
  }

  // — Placeholder content —
  let placeholderImages = 0;
  for (const domain of GENERIC_PLACEHOLDER_DOMAINS) {
    placeholderImages += $(`img[src*="${domain}"]`).length;
  }
  if (placeholderImages > 0) {
    signals.push({ reason: `${placeholderImages} placeholder image(s) found — content not filled in`, weight: 20 });
  }

  // — AI-generated copy —
  let aiCopyMatches = 0;
  for (const pattern of AI_COPY_PATTERNS) {
    if (pattern.test(html)) aiCopyMatches++;
  }
  if (aiCopyMatches >= 4) {
    signals.push({ reason: `Heavy AI-style marketing copy (${aiCopyMatches} pattern matches)`, weight: 22 });
  } else if (aiCopyMatches >= 2) {
    signals.push({ reason: `Generic AI marketing copy detected (${aiCopyMatches} patterns)`, weight: 12 });
  } else if (aiCopyMatches === 1) {
    signals.push({ reason: 'Minor generic copy pattern detected', weight: 5 });
  }

  // — Component library patterns (shadcn/radix) —
  let shadcnSignals = 0;
  if (html.includes('data-radix-')) shadcnSignals++;
  if (html.includes('cmdk-')) shadcnSignals++;
  if (html.includes('@radix-ui')) shadcnSignals++;
  if (/class="[^"]*lucide[^"]*"/.test(html)) shadcnSignals++;
  if (html.includes('vaul-drawer')) shadcnSignals++;
  if (shadcnSignals >= 2) {
    signals.push({ reason: 'shadcn/ui component library detected (default AI assistant scaffold)', weight: 12 });
  }

  // — Generic navigation structure —
  const navTexts = $('nav a, header a, [role="navigation"] a')
    .map((_, el) => $(el).text().trim().toLowerCase())
    .get()
    .filter(Boolean);
  const genericNavItems = ['home', 'about', 'features', 'pricing', 'contact', 'blog', 'docs', 'sign in', 'login', 'get started', 'dashboard'];
  const genericNavCount = navTexts.filter(t => genericNavItems.some(g => t.includes(g))).length;
  if (navTexts.length > 0 && genericNavCount >= 4) {
    signals.push({ reason: 'Generic SaaS navigation structure (Home / Features / Pricing / Contact)', weight: 8 });
  }

  // — Generic CTA buttons —
  const buttonTexts = $('button, a[class*="btn"], a[class*="button"], [role="button"]')
    .map((_, el) => $(el).text().trim().toLowerCase())
    .get();
  const genericCTAs = ['get started', 'try for free', 'start free trial', 'sign up free', 'start now', 'get started for free', 'try it free'];
  const genericCTACount = buttonTexts.filter(t => genericCTAs.some(g => t.includes(g))).length;
  if (genericCTACount >= 2) {
    signals.push({ reason: `${genericCTACount} generic CTA button patterns detected`, weight: 10 });
  }

  // — Sparse text vs code size —
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(' ').filter(Boolean).length;
  if (wordCount < 80 && html.length > 8000) {
    signals.push({ reason: 'Very little visible text relative to code complexity', weight: 8 });
  }

  // — Missing meta description —
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  if (!metaDesc) {
    signals.push({ reason: 'Missing meta description (frequently skipped in AI-generated projects)', weight: 5 });
  } else if (/^(A|An|The)\s+\w+\s+(app|application|website|platform)\.?$/i.test(metaDesc)) {
    signals.push({ reason: 'One-liner generic meta description', weight: 8 });
  }

  // — Very high Tailwind class density —
  const tailwindClassCount = (html.match(/class(?:Name)?="[^"]*(?:flex|grid|p-\d|m-\d|text-\w|bg-\w|border-\w|rounded|shadow|gap-)[^"]*"/g) || []).length;
  const totalTags = (html.match(/<[a-z][a-z0-9]*/gi) || []).length;
  if (totalTags > 20) {
    const ratio = tailwindClassCount / totalTags;
    if (ratio > 0.75) {
      signals.push({ reason: 'Extreme Tailwind CSS density (utility-first generated layout)', weight: 10 });
    } else if (ratio > 0.55) {
      signals.push({ reason: 'High Tailwind CSS usage consistent with scaffold generation', weight: 5 });
    }
  }

  // — Section structure typical of AI SaaS templates —
  const sections = $('section, [class*="section"]').length;
  const hasHero = $('[class*="hero"], [id*="hero"], h1').length > 0;
  const hasFeatures = $('[class*="feature"], [id*="feature"]').length > 0;
  const hasPricing = $('[class*="pricing"], [id*="pricing"]').length > 0;
  const hasTestimonials = $('[class*="testimonial"], [class*="review"]').length > 0;
  const saasBlockCount = [hasHero, hasFeatures, hasPricing, hasTestimonials].filter(Boolean).length;
  if (saasBlockCount >= 3) {
    signals.push({ reason: `Classic AI SaaS template structure: hero + features + pricing${hasTestimonials ? ' + testimonials' : ''}`, weight: 12 });
  }

  // Calculate score
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = Math.min(100, Math.max(0, Math.round(totalWeight)));

  // Confidence based on signal count and weight spread
  let confidence: ConfidenceLevel;
  if (signals.length >= 5 || totalWeight >= 60) {
    confidence = 'High';
  } else if (signals.length >= 3 || totalWeight >= 25) {
    confidence = 'Medium';
  } else {
    confidence = 'Low';
  }

  return { score, reasons: signals.map(s => s.reason), confidence };
}

export function getVibeLabel(score: number): VibeLabel {
  if (score >= 70) return 'Likely Vibe-Coded';
  if (score >= 30) return 'Possibly Vibe-Coded';
  return 'Likely Hand-Coded';
}
