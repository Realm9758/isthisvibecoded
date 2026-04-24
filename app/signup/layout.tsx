import type { Metadata } from 'next';

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Create Account — Is This Vibe-Coded?',
  description: 'Sign up free to scan sites for vibe-coding, audit security headers, and share results.',
  alternates: { canonical: `${BASE}/signup` },
  openGraph: {
    type: 'website',
    url: `${BASE}/signup`,
    title: 'Create Account — Is This Vibe-Coded?',
    description: 'Sign up free to scan sites for vibe-coding, audit security headers, and share results.',
    images: [{ url: `${BASE}/og/default.png` }],
  },
  twitter: { card: 'summary_large_image' },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
