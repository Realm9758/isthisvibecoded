import Link from 'next/link';
import type { Metadata } from 'next';
import { ScanReport } from '@/components/ScanReport';
import { getOwnedScan, getPreviousScan } from '@/lib/scan-store';
import { diffScans } from '@/lib/scan-diff';

/**
 * A stored scan, readable only by the account that owns it.
 *
 * The metadata is deliberately blank of detail. A scan can describe a site
 * its owner does not control, so nothing here should render a finding into a
 * link preview that gets pasted into a group chat.
 */
export const metadata: Metadata = {
  title: 'Scan result | Ironclad',
  description: 'A private Ironclad scan result.',
  robots: { index: false, follow: false },
};

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scan = await getOwnedScan(id);

  if (!scan) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0a0a0f' }}>
        <div className="text-center max-w-sm">
          <p className="text-6xl mb-6 opacity-20">◌</p>
          <h1 className="text-xl font-semibold text-white/70 mb-2">Scan not available</h1>
          <p className="text-white/40 text-sm mb-8 leading-relaxed">
            Either this scan does not exist, or it belongs to another account. Scan results are private to
            the person who ran them.
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

  const previous = await getPreviousScan(scan);
  const diff = diffScans(previous, scan.result);

  return (
    <main className="min-h-screen px-6 py-10" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(139,92,246,0.1) 0%, transparent 70%)',
        }}
      />
      <div className="relative max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Link href="/dashboard" className="text-sm text-white/35 hover:text-white/70 transition-colors">
            Back to your scans
          </Link>
        </div>
        <ScanReport result={scan.result} diff={diff} />
      </div>
    </main>
  );
}
