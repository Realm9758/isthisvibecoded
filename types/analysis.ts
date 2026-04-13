export type ConfidenceLevel = 'Low' | 'Medium' | 'High';
export type RiskLevel = 'Low Risk' | 'Medium Risk' | 'High Risk';
export type VibeLabel = 'Likely Hand-Coded' | 'Possibly Vibe-Coded' | 'Likely Vibe-Coded';
export type HeaderSeverity = 'critical' | 'high' | 'medium' | 'low';
export type TechCategory = 'framework' | 'library' | 'hosting' | 'cdn' | 'analytics' | 'backend' | 'database';
export type KeyRisk = 'info' | 'low' | 'medium' | 'high';

export interface SecurityHeaderResult {
  name: string;
  present: boolean;
  value?: string;
  severity: HeaderSeverity;
  recommendation: string;
}

export interface TechStackItem {
  name: string;
  category: TechCategory;
  confidence: ConfidenceLevel;
}

export interface PublicFile {
  path: string;
  accessible: boolean;
  status: number;
}

export interface PublicKey {
  type: string;
  value: string;
  source: string;
  risk: KeyRisk;
}

export interface VibeResult {
  score: number;
  label: VibeLabel;
  confidence: ConfidenceLevel;
  reasons: string[];
}

export interface SecurityResult {
  score: number;
  riskLevel: RiskLevel;
  headers: SecurityHeaderResult[];
  httpsEnabled: boolean;
}

export interface AnalysisResult {
  url: string;
  scannedAt: string;
  vibe: VibeResult;
  security: SecurityResult;
  techStack: TechStackItem[];
  hosting: {
    provider: string | null;
    indicators: string[];
  };
  publicFiles: PublicFile[];
  publicKeys: PublicKey[];
}

export interface VerificationToken {
  token: string;
  domain: string;
  createdAt: string;
  methods: {
    dns: string;
    metaTag: string;
    filePath: string;
    fileContent: string;
  };
}
