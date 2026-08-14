import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { SITE_ORIGIN } from '@/lib/site';
import { Providers } from './providers';
import { Navbar } from '@/components/Navbar';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

const BASE = SITE_ORIGIN;

export const metadata: Metadata = {
  title: 'Ironclad: is your site ironclad?',
  description: 'Point it at any URL and find leaked keys, exposed config files, missing headers, and the other things that ship when nobody was looking.',
  alternates: { canonical: BASE },
  openGraph: {
    type: 'website',
    url: BASE,
    title: 'Ironclad: is your site ironclad?',
    description: 'Point it at any URL and find leaked keys, exposed config files, missing headers, and the other things that ship when nobody was looking.',
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
      <head>
        {/*
          Scroll reveals are applied by JavaScript. With scripting off nothing
          ever adds .is-in, so without this the marketing pages would render as
          an empty column. A stylesheet cannot test for scripting, so the
          override has to ride here.
        */}
        <noscript>
          <style>{'[data-reveal]{opacity:1!important;transform:none!important;filter:none!important}.rule-draw{transform:scaleX(1)!important}'}</style>
        </noscript>
      </head>
      <body className="min-h-screen bg-[#0a0a0f] text-[#e8e8f0] antialiased">
        <Providers>
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
