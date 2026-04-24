import type { Metadata } from 'next';

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Community — Is This Vibe-Coded?',
  description: 'Sites that passed the Deep Scan. Shared by real users. Certified clean.',
  alternates: { canonical: `${BASE}/community` },
  openGraph: {
    type: 'website',
    url: `${BASE}/community`,
    title: 'Community — Is This Vibe-Coded?',
    description: 'Sites that passed the Deep Scan. Shared by real users. Certified clean.',
    images: [{ url: `${BASE}/og/default.png` }],
  },
  twitter: { card: 'summary_large_image' },
};

export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
