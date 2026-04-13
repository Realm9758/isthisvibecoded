interface HostingResult {
  provider: string | null;
  indicators: string[];
}

const HOSTING_RULES: Array<{
  provider: string;
  test: (html: string, headers: Record<string, string>) => string | null;
}> = [
  {
    provider: 'Vercel',
    test: (html, headers) => {
      if (headers['x-vercel-id']) return 'x-vercel-id header present';
      if ((headers['server'] ?? '').toLowerCase().includes('vercel')) return 'Server: Vercel header';
      if (html.includes('.vercel.app')) return 'vercel.app domain in source';
      return null;
    },
  },
  {
    provider: 'Netlify',
    test: (html, headers) => {
      if (headers['x-nf-request-id']) return 'x-nf-request-id header (Netlify)';
      if (headers['x-netlify-cache']) return 'x-netlify-cache header';
      if (html.includes('.netlify.app')) return 'netlify.app domain in source';
      return null;
    },
  },
  {
    provider: 'Cloudflare',
    test: (_, headers) => {
      if ((headers['server'] ?? '').toLowerCase() === 'cloudflare') return 'Server: cloudflare header';
      if (headers['cf-ray']) return 'cf-ray header present';
      return null;
    },
  },
  {
    provider: 'AWS CloudFront',
    test: (_, headers) => {
      if (headers['x-amz-cf-id']) return 'x-amz-cf-id header (CloudFront)';
      if (headers['x-amz-request-id']) return 'x-amz-request-id header';
      return null;
    },
  },
  {
    provider: 'GitHub Pages',
    test: (html, headers) => {
      if (html.includes('.github.io')) return 'github.io domain in source';
      return null;
    },
  },
  {
    provider: 'Fly.io',
    test: (_, headers) => {
      if (headers['fly-request-id']) return 'fly-request-id header';
      return null;
    },
  },
  {
    provider: 'Render',
    test: (html, headers) => {
      if (html.includes('.onrender.com')) return 'onrender.com domain in source';
      return null;
    },
  },
  {
    provider: 'Firebase Hosting',
    test: (_, headers) => {
      if (headers['x-firebase-appcheck']) return 'x-firebase-appcheck header';
      if ((headers['server'] ?? '').toLowerCase().includes('firebase')) return 'Server: firebase';
      return null;
    },
  },
];

export function detectHosting(html: string, headers: Record<string, string>): HostingResult {
  const indicators: string[] = [];

  for (const rule of HOSTING_RULES) {
    const indicator = rule.test(html, headers);
    if (indicator) {
      return { provider: rule.provider, indicators: [indicator] };
    }
  }

  return { provider: null, indicators: [] };
}
