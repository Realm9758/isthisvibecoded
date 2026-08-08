export type ConfidenceLevel = 'Low' | 'Medium' | 'High';
export type RiskLevel = 'Low Risk' | 'Medium Risk' | 'High Risk';
export type VibeLabel =
  | 'Inconclusive'
  | 'Limited supporting evidence'
  | 'Strong supporting evidence'
  | 'Direct AI-builder provenance';
export type HeaderSeverity = 'critical' | 'high' | 'medium' | 'low';
export type TechCategory = 'framework' | 'library' | 'hosting' | 'cdn' | 'analytics' | 'backend' | 'database';
export type KeyRisk = 'info' | 'low' | 'medium' | 'high';
export type VibeEvidenceCategory = 'provenance' | 'scaffold' | 'stack' | 'content' | 'conflict';
export type VibeEvidenceStrength = 'direct' | 'strong' | 'moderate' | 'weak';

export interface VibeEvidenceSignal {
  id: string;
  category: VibeEvidenceCategory;
  direction: 'supports' | 'conflicts' | 'context';
  strength: VibeEvidenceStrength;
  points: number;
  correlationKey?: string;
  source: 'hostname' | 'headers' | 'metadata' | 'markup' | 'content';
  description: string;
  evidence?: string;
}

export interface VibeScoreBreakdown {
  provenance: number;
  scaffold: number;
  stack: number;
  content: number;
  conflictPenalty: number;
  total: number;
  independentSupportingCategories: number;
  modelVersion: string;
  scoreKind: 'evidence-index';
}

export interface SecurityHeaderResult {
  name: string;
  /** Whether the header (or a standards-equivalent control) was detected. */
  present: boolean;
  value?: string;
  /** False when a header exists but its value does not provide the intended protection. */
  valid?: boolean;
  details?: string;
  penaltyApplied?: number;
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
  confidence?: ConfidenceLevel;
  evidence?: string;
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
  signals?: VibeEvidenceSignal[];
  breakdown?: VibeScoreBreakdown;
  declaredGenerator?: string;
  limitations?: string[];
}

export interface SecurityResult {
  score: number;
  riskLevel: RiskLevel;
  headers: SecurityHeaderResult[];
  httpsEnabled: boolean;
  /** Identifies the non-probabilistic header-hardening rubric. */
  modelVersion?: string;
}

export interface AnalysisCoverage {
  responseStatus: number;
  contentType: string;
  htmlBytes: number;
  redirectsFollowed: number;
  publicPathChecks: {
    attempted: number;
    completed: number;
    failed: number;
  };
  limitations: string[];
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
  coverage?: AnalysisCoverage;
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
