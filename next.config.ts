import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Ironclad is served at bhopstudio.com/ironclad, not on its own domain, so
 * every route, API handler and static asset carries a prefix. The parent
 * project rewrites /ironclad and /ironclad/:path* here, and the prefix has to
 * be present on both sides of that rewrite.
 *
 * Derived from NEXT_PUBLIC_APP_URL so the prefix, the auth cookie's scope and
 * the URL the scanner advertises cannot drift apart. lib/site.ts reads the
 * same variable, and falls back to the same production URL, so a missing
 * variable cannot leave the two disagreeing about whether the prefix exists.
 * Locally the URL has no path, so this is empty and the app behaves as though
 * it owns its origin.
 */
const CANONICAL_URL = 'https://bhopstudio.com/ironclad';

const basePath = (() => {
  try {
    const path = new URL(process.env.NEXT_PUBLIC_APP_URL || CANONICAL_URL).pathname.replace(/\/+$/, '');
    return path === '' || path === '/' ? '' : path;
  } catch {
    return new URL(CANONICAL_URL).pathname;
  }
})();

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co https://api.stripe.com",
      "frame-src https://js.stripe.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      ...(isProduction ? ['upgrade-insecure-requests'] : []),
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  basePath,
  poweredByHeader: false,
  async redirects() {
    // Routes that existed before the repositioning. Anything already linking
    // to them, including search results, should land somewhere real.
    return [
      { source: '/security',      destination: '/what-we-check', permanent: true },
      { source: '/vulnerability', destination: '/what-we-check', permanent: true },
      { source: '/feed',          destination: '/',              permanent: true },
      { source: '/u/:name',       destination: '/',              permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
