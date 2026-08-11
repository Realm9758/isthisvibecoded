import type { Metadata } from 'next';

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Sign In | Ironclad',
  description: 'Sign in to your Ironclad account to see your scan history.',
  alternates: { canonical: `${BASE}/login` },
  openGraph: {
    type: 'website',
    url: `${BASE}/login`,
    title: 'Sign In | Ironclad',
    description: 'Sign in to your Ironclad account to see your scan history.',
    images: [{ url: `${BASE}/og/default.png` }],
  },
  twitter: { card: 'summary_large_image' },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
