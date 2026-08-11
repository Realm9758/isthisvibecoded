/**
 * Vocabulary shared by the detectors.
 *
 * This file used to describe the passive scanner's composite result. That
 * pipeline is gone: DeepScanResult in types/deep-scan.ts is now the single
 * shape a scan produces, at either lane. What remains is the smaller
 * vocabulary the surviving detectors speak, plus the domain-verification
 * token, which has nothing to do with scanning at all.
 */

export type ConfidenceLevel = 'Low' | 'Medium' | 'High';
/** Legacy field name; values describe only the bounded response-header rubric. */
export type RiskLevel = 'Few Header Gaps' | 'Some Header Gaps' | 'Major Header Gaps';
export type VibeLabel =
  | 'Inconclusive'
  | 'Limited supporting evidence'
  | 'Strong supporting evidence'
  | 'Direct AI-builder provenance';
export type HeaderSeverity = 'critical' | 'high' | 'medium' | 'low';
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

export interface PublicKey {
  type: string;
  value: string;
  source: string;
  risk: KeyRisk;
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
