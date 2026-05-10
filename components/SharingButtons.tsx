'use client';

import { useState } from 'react';

interface Props {
  scanId: string;
  vibeScore: number;
  vibeLabel: string;
  securityScore: number;
  domain: string;
}

export function SharingButtons({ scanId, vibeScore, vibeLabel, securityScore, domain }: Props) {
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const resultUrl = `${appUrl}/result/${scanId}`;

  const tweetText = encodeURIComponent(
    `I just scanned ${domain} with @VibeScan!\n\n` +
    `AI Signal Score: ${vibeScore}/100 (${vibeLabel})\n` +
    `Security Score: ${securityScore}/100\n\n` +
    `Check your own site →`
  );
  const tweetUrl = `https://x.com/intent/tweet?text=${tweetText}&url=${encodeURIComponent(resultUrl)}`;

  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(resultUrl)}`;
  const redditUrl = `https://reddit.com/submit?url=${encodeURIComponent(resultUrl)}&title=${encodeURIComponent(`${domain} AI signal score: ${vibeScore}/100 — VibeScan`)}`;

  const embedCode = `<a href="${resultUrl}" target="_blank" rel="noopener">
  <img src="${appUrl}/api/badge/${scanId}" alt="VibeScan badge for ${domain}" height="72" />
</a>`;

  async function copyLink() {
    await navigator.clipboard.writeText(resultUrl);
    setCopied('link');
    setTimeout(() => setCopied(null), 2000);
  }

  async function copyEmbed() {
    await navigator.clipboard.writeText(embedCode);
    setCopied('embed');
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-3">
      {/* Share URL */}
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/3 border border-white/8">
        <span className="text-xs font-mono text-white/40 flex-1 truncate">{resultUrl}</span>
        <button
          onClick={copyLink}
          className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-white/8 hover:bg-white/12 text-white/60 hover:text-white/90 transition-colors"
        >
          {copied === 'link' ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Social buttons */}
      <div className="flex flex-wrap gap-2">
        <a
          href={tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:text-white/80 hover:border-white/20 transition-colors text-xs"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.213 5.567zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
          Share on X
        </a>
        <a
          href={linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:text-white/80 hover:border-white/20 transition-colors text-xs"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
          LinkedIn
        </a>
        <a
          href={redditUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:text-white/80 hover:border-white/20 transition-colors text-xs"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
          </svg>
          Reddit
        </a>
      </div>

      {/* Embed code */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-white/30">Embed badge</span>
          <button onClick={copyEmbed} className="text-xs text-white/30 hover:text-white/60 transition-colors">
            {copied === 'embed' ? 'Copied!' : 'Copy code'}
          </button>
        </div>
        <pre className="text-xs font-mono bg-black/30 border border-white/8 rounded-lg p-2.5 text-white/40 overflow-x-auto whitespace-pre-wrap">
          {embedCode}
        </pre>
      </div>
    </div>
  );
}
