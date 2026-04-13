export type DeepFindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type DeepFindingCategory =
  | 'exposed-files'
  | 'cors'
  | 'headers'
  | 'cookies'
  | 'http-methods'
  | 'info-disclosure'
  | 'ssl'
  | 'authentication';

export interface DeepFinding {
  id: string;
  category: DeepFindingCategory;
  severity: DeepFindingSeverity;
  title: string;
  description: string;
  evidence?: string;
  remediation: string;
  url?: string;
}

export interface DeepScanResult {
  domain: string;
  scannedAt: string;
  duration: number;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    score: number;
  };
  findings: DeepFinding[];
}
