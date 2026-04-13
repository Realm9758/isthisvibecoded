'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface FeedItem {
  id: string;
  url: string;
  vibeScore: number;
  vibeLabel: string;
  securityScore: number;
  riskLevel: string;
  techStack: string[];
  hosting: string | null;
  createdAt: number;
}

interface PopularItem {
  domain: string;
  count: number;
  latestScan: { id: string };
}

type Tab = 'recent' | 'vibe' | 'secure' | 'popular';

function getVibeColor(s: number) { return s >= 70 ? '#8b5cf6' : s >= 30 ? '#f59e0b' : '#22c55e'; }
function getSecColor(s: number) { return s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444'; }

function ScanRow({ item }: { item: FeedItem }) {
  const hostname = (() => { try { return new URL(item.url).hostname; } catch { return item.url; } })();
  const vc = getVibeColor(item.vibeScore);
  const sc = getSecColor(item.securityScore);

  return (
    <Link
      href={`/result/${item.id}`}
      className="flex items-center gap-4 px-5 py-4 border-b border-white/4 last:border-0 hover:bg-white/2 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/80 truncate group-hover:text-white transition-colors">{hostname}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {item.techStack.slice(0, 3).map(t => (
            <span key={t} className="text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded">{t}</span>
          ))}
          {item.hosting && <span className="text-[10px] text-emerald-400/60 bg-emerald-500/5 px-1.5 py-0.5 rounded">{item.hosting}</span>}
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0 text-xs">
        <div className="text-center">
          <p className="font-bold text-base tabular-nums" style={{ color: vc }}>{item.vibeScore}</p>
          <p className="text-white/25 text-[10px]">vibe</p>
        </div>
        <div className="text-center">
          <p className="font-bold text-base tabular-nums" style={{ color: sc }}>{item.securityScore}</p>
          <p className="text-white/25 text-[10px]">sec</p>
        </div>
        <div className="text-white/20 text-[10px] text-right hidden sm:block">
          {new Date(item.createdAt).toLocaleDateString()}
        </div>
      </div>
    </Link>
  );
}

export default function FeedPage() {
  const [tab, setTab] = useState<Tab>('recent');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [popular, setPopular] = useState<PopularItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (tab === 'popular') {
      fetch('/api/scans?type=popular&limit=20')
        .then(r => r.json())
        .then(d => { setPopular(d); setLoading(false); })
        .catch(() => setLoading(false));
    } else {
      fetch(`/api/scans?type=${tab}&limit=30`)
        .then(r => r.json())
        .then(d => { setItems(d); setLoading(false); })
        .catch(() => setLoading(false));
    }
  }, [tab]);

  // Auto-refresh recent tab
  useEffect(() => {
    if (tab !== 'recent') return;
    const t = setInterval(() => {
      fetch('/api/scans?type=recent&limit=30')
        .then(r => r.json())
        .then(setItems);
    }, 15_000);
    return () => clearInterval(t);
  }, [tab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'recent', label: 'Recent' },
    { id: 'vibe', label: 'Most Vibe-Coded' },
    { id: 'secure', label: 'Most Secure' },
    { id: 'popular', label: 'Most Scanned' },
  ];

  return (
    <main className="min-h-screen px-6 py-16" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(139,92,246,0.08) 0%, transparent 70%)' }}
      />
      <div className="relative max-w-3xl mx-auto">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Public Scan Feed</h1>
          <p className="text-white/40 text-sm">Live results from websites scanned by the community</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/3 border border-white/6 mb-6 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${tab === t.id ? 'bg-white/10 text-white/90' : 'text-white/40 hover:text-white/70'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="rounded-xl border border-white/6 bg-white/2 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-white/30 text-sm">Loading…</div>
          ) : tab === 'popular' ? (
            popular.length === 0 ? (
              <div className="py-16 text-center text-white/30 text-sm">No scans yet. <Link href="/" className="text-violet-400">Be the first →</Link></div>
            ) : (
              popular.map((item, i) => (
                <Link key={item.domain} href={`/result/${item.latestScan.id}`}
                  className="flex items-center gap-4 px-5 py-4 border-b border-white/4 last:border-0 hover:bg-white/2 transition-colors">
                  <span className="text-white/20 text-sm w-6 text-right shrink-0">{i + 1}</span>
                  <p className="flex-1 text-sm font-medium text-white/80 truncate">{item.domain}</p>
                  <span className="text-xs text-white/30">{item.count} scan{item.count !== 1 ? 's' : ''}</span>
                </Link>
              ))
            )
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-white/30 text-sm">
              No scans yet. <Link href="/" className="text-violet-400">Scan a site →</Link>
            </div>
          ) : (
            items.map(item => <ScanRow key={item.id} item={item} />)
          )}
        </div>

        {tab === 'recent' && (
          <p className="text-center text-xs text-white/20 mt-4">Auto-refreshes every 15 seconds</p>
        )}
      </div>
    </main>
  );
}
