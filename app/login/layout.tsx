import type { Metadata } from 'next';

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Sign In — Is This Vibe-Coded?',
  description: 'Sign in to your VibeScan account to track scans, comments, and security reports.',
  alternates: { canonical: `${BASE}/login` },
  openGraph: {
    type: 'website',
    url: `${BASE}/login`,
    title: 'Sign In — Is This Vibe-Coded?',
    description: 'Sign in to your VibeScan account to track scans, comments, and security reports.',
    images: [{ url: `${BASE}/og/default.png` }],
  },
  twitter: { card: 'summary_large_image' },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
