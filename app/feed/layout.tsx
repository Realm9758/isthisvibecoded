import type { Metadata } from 'next';

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Feed — Is This Vibe-Coded?',
  description: 'Browse explicitly published sites by public provenance evidence and header hardening.',
  alternates: { canonical: `${BASE}/feed` },
  openGraph: {
    type: 'website',
    url: `${BASE}/feed`,
    title: 'Feed — Is This Vibe-Coded?',
    description: 'Browse explicitly published sites by public provenance evidence and header hardening.',
    images: [{ url: `${BASE}/og/default.png` }],
  },
  twitter: { card: 'summary_large_image' },
};

export default function FeedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
