'use client';

import { useRouter } from 'next/navigation';
import { ResultsDashboard } from '@/components/ResultsDashboard';
import type { AnalysisResult } from '@/types/analysis';

interface Props {
  result: AnalysisResult & { scanId: string; roasts: string[]; scansRemaining: null };
}

export function SharedResult({ result }: Props) {
  const router = useRouter();
  return <ResultsDashboard result={result} onReset={() => router.push('/')} />;
}
