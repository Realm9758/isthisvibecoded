import { getScan } from '@/lib/store';
import { SharedResult } from './SharedResult';
import Link from 'next/link';
import type { AnalysisResult } from '@/types/analysis';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;
  const scan = await getScan(id);
  if (!scan) return { title: 'Scan not found — VibeScan' };

  const domain = (() => { try { return new URL(scan.result.url).hostname; } catch { return scan.result.url; } })();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://isthisvibecoded.com';
  const cardUrl = `${appUrl}/api/sharecard/${id}`;
  const pageUrl = `${appUrl}/result/${id}`;

  const title = `${domain} AI signal score: ${scan.result.vibe.score}/100`;
  const description =
    `${scan.result.vibe.label} · Security: ${scan.result.security.score}/100 · ${scan.result.security.riskLevel} · ` +
    `${scan.result.techStack.slice(0, 3).map(t => t.name).join(', ') || 'Unknown stack'}`;

  return {
    title: `${title} | VibeScan`,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      images: [{ url: cardUrl, width: 600, height: 315 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [cardUrl],
    },
  };
}

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scan = await getScan(id);

  if (!scan) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0a0a0f' }}>
        <div className="text-center">
          <p className="text-6xl mb-6 opacity-20">◌</p>
          <h1 className="text-xl font-semibold text-white/70 mb-2">Scan not found</h1>
          <p className="text-white/40 text-sm mb-8">
            This result may have expired or the link is invalid.
          </p>
          <Link
            href="/"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
          >
            Run a new scan
          </Link>
        </div>
      </main>
    );
  }

  const result = {
    ...scan.result,
    scanId: scan.id,
    roasts: scan.roasts,
    scansRemaining: null,
  } as AnalysisResult & { scanId: string; roasts: string[]; scansRemaining: null };

  return (
    <main className="min-h-screen px-6 py-10" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(139,92,246,0.1) 0%, transparent 70%)',
        }}
      />
      <div className="relative max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Link href="/" className="text-xs text-white/30 hover:text-white/60 transition-colors">
            ← Run new scan
          </Link>
          <span className="text-white/15">·</span>
          <span className="text-xs text-white/20">Shared result</span>
        </div>
        <SharedResult result={result} />
      </div>
    </main>
  );
}
