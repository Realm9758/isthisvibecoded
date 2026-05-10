'use client';

import { useState, useEffect } from 'react';
import type { AnalysisResult } from '@/types/analysis';
import { Confetti } from './Confetti';

interface Props {
  result: AnalysisResult & { scanId?: string };
  onClose: () => void;
}

function buildSummary(result: AnalysisResult, domain: string): string {
  const tech = result.techStack.slice(0, 3).map(t => t.name).join(' + ');
  const techPart = tech ? ` Built with ${tech}.` : '';
  return (
    `${domain} scored ${result.vibe.score}/100 for public AI-generation signals (${result.vibe.label}). ` +
    `Security: ${result.security.score}/100 — ${result.security.riskLevel}.` +
    `${techPart} Check yours at isthisvibecoded.com`
  );
}

export function ShareModal({ result, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [confetti, setConfetti] = useState(false);

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const resultUrl = result.scanId ? `${appUrl}/result/${result.scanId}` : appUrl;
  const domain = (() => { try { return new URL(result.url).hostname; } catch { return result.url; } })();
  const summary = buildSummary(result, domain);

  const vibeColor = result.vibe.score >= 70 ? '#8b5cf6' : result.vibe.score >= 30 ? '#f59e0b' : '#22c55e';
  const secColor = result.security.score >= 70 ? '#22c55e' : result.security.score >= 40 ? '#f59e0b' : '#ef4444';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function pop() {
    setConfetti(true);
    setTimeout(() => setConfetti(false), 3500);
  }

  function openShare(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer,width=600,height=500');
    pop();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(resultUrl);
    setCopied(true);
    pop();
    setTimeout(() => setCopied(false), 2000);
  }

  async function downloadCard() {
    if (!result.scanId) return;
    const res = await fetch(`/api/sharecard/${result.scanId}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibescan-${domain}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    pop();
  }

  const tweetText = encodeURIComponent(`${summary} →`);
  const shareLink = encodeURIComponent(resultUrl);
  const twitterUrl = `https://x.com/intent/tweet?text=${tweetText}&url=${shareLink}`;
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${shareLink}`;
  const redditUrl = `https://reddit.com/submit?url=${shareLink}&title=${encodeURIComponent(`${domain} AI signal score: ${result.vibe.score}/100 — VibeScan Results`)}`;

  const tech = result.techStack.slice(0, 3).map(t => t.name);

  return (
    <>
      <Confetti active={confetti} />

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-lg rounded-2xl border border-white/10 overflow-hidden animate-fade-in-up"
          style={{ background: '#0c0c18' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              <h2 className="text-sm font-semibold text-white/80">Share Results</h2>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white/70 hover:bg-white/8 transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>

          <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
            {/* Visual card preview */}
            <div
              className="rounded-xl border border-white/8 p-5 relative overflow-hidden cursor-pointer group"
              style={{ background: 'linear-gradient(135deg, #111124 0%, #0d0d1c 100%)' }}
              onClick={downloadCard}
              title="Click to download card"
            >
              {/* Glow orb */}
              <div
                className="absolute -top-8 -right-8 w-40 h-40 rounded-full pointer-events-none"
                style={{ background: vibeColor, filter: 'blur(50px)', opacity: 0.12 }}
              />

              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-[9px] font-black tracking-[0.2em] uppercase mb-1" style={{ color: vibeColor }}>
                    VIBESCAN
                  </p>
                  <p className="text-base font-bold text-white leading-tight">{domain}</p>
                  <p className="text-[10px] text-white/30 mt-0.5">{new Date(result.scannedAt).toLocaleDateString()}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-4xl font-black leading-none" style={{ color: vibeColor }}>
                    {result.vibe.score}
                  </p>
                  <p className="text-[9px] text-white/35 mt-0.5 uppercase tracking-wide">AI signals</p>
                </div>
              </div>

              <div className="flex gap-2 mb-3">
                <div className="flex-1 rounded-lg bg-white/5 border border-white/8 px-2.5 py-2">
                  <p className="text-[9px] text-white/30 uppercase tracking-wider">Security</p>
                  <p className="text-sm font-bold mt-0.5" style={{ color: secColor }}>
                    {result.security.score}<span className="text-xs font-normal text-white/20">/100</span>
                  </p>
                </div>
                <div className="flex-1 rounded-lg bg-white/5 border border-white/8 px-2.5 py-2">
                  <p className="text-[9px] text-white/30 uppercase tracking-wider">Risk</p>
                  <p className="text-sm font-bold mt-0.5 capitalize" style={{ color: secColor }}>
                    {result.security.riskLevel}
                  </p>
                </div>
                {tech.length > 0 && (
                  <div className="flex-[2] rounded-lg bg-white/5 border border-white/8 px-2.5 py-2">
                    <p className="text-[9px] text-white/30 uppercase tracking-wider">Stack</p>
                    <p className="text-xs font-semibold text-white/70 mt-0.5 truncate">{tech.join(' · ')}</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-[9px] text-white/15">isthisvibecoded.com</p>
                <span className="text-[9px] text-white/25 group-hover:text-white/50 transition-colors">
                  ↓ click to download
                </span>
              </div>
            </div>

            {/* Auto summary */}
            <div className="rounded-xl bg-white/3 border border-white/6 p-3.5">
              <p className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">Auto summary</p>
              <p className="text-xs text-white/55 leading-relaxed">{summary}</p>
            </div>

            {/* Platform buttons */}
            <div>
              <p className="text-[10px] text-white/25 uppercase tracking-wider mb-2">Share to</p>
              <div className="grid grid-cols-2 gap-2">
                {/* X / Twitter */}
                <button
                  onClick={() => openShare(twitterUrl)}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-white/8 hover:border-white/18 hover:bg-white/4 transition-all text-sm text-white/60 hover:text-white/90 group"
                >
                  <svg className="w-3.5 h-3.5 shrink-0 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.213 5.567zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  X (Twitter)
                </button>

                {/* LinkedIn */}
                <button
                  onClick={() => openShare(linkedinUrl)}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-white/8 hover:border-white/18 hover:bg-white/4 transition-all text-sm text-white/60 hover:text-white/90 group"
                >
                  <svg className="w-3.5 h-3.5 shrink-0 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  LinkedIn
                </button>

                {/* Reddit */}
                <button
                  onClick={() => openShare(redditUrl)}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-white/8 hover:border-white/18 hover:bg-white/4 transition-all text-sm text-white/60 hover:text-white/90 group"
                >
                  <svg className="w-3.5 h-3.5 shrink-0 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
                  </svg>
                  Reddit
                </button>

                {/* Download for Instagram */}
                <button
                  onClick={downloadCard}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-white/8 hover:border-white/18 hover:bg-white/4 transition-all text-sm text-white/60 hover:text-white/90 group"
                >
                  <svg className="w-3.5 h-3.5 shrink-0 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Card
                </button>
              </div>
            </div>

            {/* Copy link */}
            <div className="flex items-center gap-2 p-3 rounded-xl bg-white/3 border border-white/8">
              <span className="text-xs font-mono text-white/30 flex-1 truncate">{resultUrl}</span>
              <button
                onClick={copyLink}
                className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                style={{
                  background: copied ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.07)',
                  color: copied ? '#22c55e' : 'rgba(255,255,255,0.55)',
                  border: `1px solid ${copied ? 'rgba(34,197,94,0.25)' : 'transparent'}`,
                }}
              >
                {copied ? '✓ Copied!' : 'Copy Link'}
              </button>
            </div>

            {/* Scan another CTA */}
            <button
              onClick={onClose}
              className="w-full py-2.5 text-xs text-white/30 hover:text-white/60 transition-colors"
            >
              Scan another site →
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
