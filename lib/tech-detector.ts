import * as cheerio from 'cheerio';
import type { TechStackItem, TechCategory, ConfidenceLevel } from '@/types/analysis';

interface DetectionRule {
  name: string;
  category: TechCategory;
  confidence: ConfidenceLevel;
  test: (html: string, headers: Record<string, string>) => boolean;
}

const RULES: DetectionRule[] = [
  // Frameworks
  {
    name: 'Next.js',
    category: 'framework',
    confidence: 'High',
    test: (html, headers) =>
      html.includes('__NEXT_DATA__') ||
      html.includes('/_next/static') ||
      (headers['x-powered-by'] ?? '').toLowerCase().includes('next.js'),
  },
  {
    name: 'React',
    category: 'framework',
    confidence: 'High',
    test: (html) =>
      html.includes('data-reactroot') ||
      html.includes('__REACT_DEVTOOLS_GLOBAL_HOOK__') ||
      html.includes('react-dom') ||
      /<div\s+id="(root|app)"\s*>/.test(html),
  },
  {
    name: 'Vue.js',
    category: 'framework',
    confidence: 'High',
    test: (html) =>
      html.includes('__vue_app__') ||
      html.includes('v-app') ||
      html.includes('vue.runtime') ||
      html.includes('data-v-'),
  },
  {
    name: 'Nuxt.js',
    category: 'framework',
    confidence: 'High',
    test: (html) => html.includes('__NUXT__') || html.includes('/_nuxt/'),
  },
  {
    name: 'Angular',
    category: 'framework',
    confidence: 'High',
    test: (html) =>
      html.includes('ng-version') ||
      html.includes('ng-app') ||
      html.includes('angular.min.js'),
  },
  {
    name: 'Svelte',
    category: 'framework',
    confidence: 'High',
    test: (html) =>
      html.includes('__svelte') ||
      html.includes('svelte-') ||
      html.includes('/_app/immutable/'),
  },
  {
    name: 'Astro',
    category: 'framework',
    confidence: 'High',
    test: (html) =>
      html.includes('data-astro-cid') ||
      html.includes('/_astro/') ||
      html.includes('astro-island'),
  },
  {
    name: 'Remix',
    category: 'framework',
    confidence: 'High',
    test: (html) => html.includes('__remixContext') || html.includes('__remix_manifest'),
  },
  {
    name: 'Gatsby',
    category: 'framework',
    confidence: 'High',
    test: (html) => html.includes('___gatsby') || html.includes('/static/gatsby-'),
  },
  {
    name: 'WordPress',
    category: 'framework',
    confidence: 'High',
    test: (html) =>
      html.includes('/wp-content/') ||
      html.includes('/wp-includes/') ||
      html.includes('wp-json'),
  },
  // Backend / BaaS
  {
    name: 'Supabase',
    category: 'backend',
    confidence: 'High',
    test: (html) => html.includes('supabase.co') || html.includes('supabase.io'),
  },
  {
    name: 'Firebase',
    category: 'backend',
    confidence: 'High',
    test: (html) =>
      html.includes('firebaseapp.com') ||
      html.includes('firebase.googleapis.com') ||
      html.includes('firebase-app'),
  },
  // Hosting
  {
    name: 'Vercel',
    category: 'hosting',
    confidence: 'High',
    test: (html, headers) =>
      !!headers['x-vercel-id'] ||
      html.includes('vercel.app') ||
      (headers['server'] ?? '').toLowerCase().includes('vercel'),
  },
  {
    name: 'Netlify',
    category: 'hosting',
    confidence: 'High',
    test: (html, headers) =>
      !!headers['x-nf-request-id'] ||
      html.includes('netlify.app') ||
      !!headers['x-netlify-cache'],
  },
  {
    name: 'Cloudflare',
    category: 'cdn',
    confidence: 'High',
    test: (_, headers) =>
      (headers['server'] ?? '').toLowerCase() === 'cloudflare' || !!headers['cf-ray'],
  },
  {
    name: 'AWS CloudFront',
    category: 'cdn',
    confidence: 'High',
    test: (_, headers) => !!headers['x-amz-cf-id'],
  },
  {
    name: 'Fly.io',
    category: 'hosting',
    confidence: 'High',
    test: (_, headers) => !!headers['fly-request-id'],
  },
  // Analytics
  {
    name: 'Google Analytics',
    category: 'analytics',
    confidence: 'High',
    test: (html) =>
      html.includes('googletagmanager.com') ||
      html.includes('google-analytics.com') ||
      html.includes('gtag('),
  },
  {
    name: 'Plausible',
    category: 'analytics',
    confidence: 'High',
    test: (html) => html.includes('plausible.io'),
  },
  {
    name: 'Segment',
    category: 'analytics',
    confidence: 'High',
    test: (html) => html.includes('segment.io') || html.includes('analytics.js'),
  },
  // Libraries
  {
    name: 'Stripe',
    category: 'library',
    confidence: 'High',
    test: (html) => html.includes('js.stripe.com'),
  },
  {
    name: 'Tailwind CSS',
    category: 'library',
    confidence: 'Medium',
    test: (html) => {
      const tailwindClasses = (html.match(/class(?:Name)?="[^"]*(?:flex|grid|p-\d|m-\d|text-\w|bg-\w|border-\w|rounded|shadow|gap-)[^"]*"/g) ?? []).length;
      const totalTags = (html.match(/<[a-z][a-z0-9]*/gi) ?? []).length;
      return totalTags > 0 && tailwindClasses / totalTags > 0.3;
    },
  },
  {
    name: 'Prisma',
    category: 'database',
    confidence: 'Medium',
    test: (html) => html.includes('prisma') && html.includes('database'),
  },
  {
    name: 'Framer Motion',
    category: 'library',
    confidence: 'High',
    test: (html) => html.includes('framer-motion') || html.includes('framermotion'),
  },
];

export function detectTechStack(
  html: string,
  headers: Record<string, string>,
): TechStackItem[] {
  const detected: TechStackItem[] = [];

  for (const rule of RULES) {
    try {
      if (rule.test(html, headers)) {
        detected.push({ name: rule.name, category: rule.category, confidence: rule.confidence });
      }
    } catch {
      // Skip on parse errors
    }
  }

  // Deduplicate by name
  const seen = new Set<string>();
  return detected.filter(item => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}
