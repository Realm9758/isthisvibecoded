import type { DeepScanResult, DeepFinding, CheckedItem } from '@/types/deep-scan';

/**
 * What an anonymous reader receives.
 *
 * They can see that three critical findings exist. They cannot see what those
 * findings are, where they are, or how to fix them. That gap is the reason to
 * create an account, and it is also why the gap has to be real: sending the
 * full object and hiding it in the client would publish every finding to
 * anyone who opens the network tab, which is the opposite of the product.
 *
 * So this runs on the server, before serialisation, and it drops fields
 * rather than blanking them.
 */

export type RedactedFinding = Pick<DeepFinding, 'id' | 'category' | 'severity' | 'title'>;
export type RedactedCheckedItem = Pick<CheckedItem, 'id' | 'label' | 'description' | 'status'>;

export type PublicScanResult =
  Omit<DeepScanResult, 'findings' | 'checked'> & {
    findings: RedactedFinding[];
    checked: RedactedCheckedItem[];
    redacted: true;
  };

export function redactForAnonymous(result: DeepScanResult): PublicScanResult {
  return {
    ...result,
    findings: result.findings.map(({ id, category, severity, title }) => ({
      id, category, severity, title,
    })),
    // `detail` is dropped because it quotes the site: a URL, a header value,
    // the name of a file that should not have been reachable.
    checked: result.checked.map(({ id, label, description, status }) => ({
      id, label, description, status,
    })),
    redacted: true,
  };
}
