import type { Metadata } from 'next';

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Feed — Is This Vibe-Coded?',
  description: 'Browse community-scanned sites ranked by vibe-code detection and security scores.',
  alternates: { canonical: `${BASE}/feed` },
  openGraph: {
    type: 'website',
    url: `${BASE}/feed`,
    title: 'Feed — Is This Vibe-Coded?',
    description: 'Browse community-scanned sites ranked by vibe-code detection and security scores.',
    images: [{ url: `${BASE}/og/default.png` }],
  },
  twitter: { card: 'summary_large_image' },
};

export default function FeedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
