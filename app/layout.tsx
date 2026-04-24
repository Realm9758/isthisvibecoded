import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Navbar } from '@/components/Navbar';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

const BASE = 'https://isthisvibecoded-one.vercel.app';

export const metadata: Metadata = {
  title: 'Is This Vibe-Coded?',
  description: 'Detect AI-generated websites, audit security headers, and identify tech stacks — instantly.',
  alternates: { canonical: BASE },
  openGraph: {
    type: 'website',
    url: BASE,
    title: 'Is This Vibe-Coded?',
    description: 'Detect AI-generated websites, audit security headers, and identify tech stacks — instantly.',
    images: [{ url: `${BASE}/og/default.png` }],
  },
  twitter: { card: 'summary_large_image' },
  other: {
    'vibecoded-verification': '3da58e179094f251086315103d2d8a9a8e86',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-[#0a0a0f] text-[#e8e8f0] antialiased">
        <Providers>
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
