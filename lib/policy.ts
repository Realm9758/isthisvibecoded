/**
 * Bump these identifiers whenever the corresponding user-facing terms change
 * materially. API routes require the exact current value so acceptance cannot
 * be inferred from an old checkbox or a direct, unversioned request.
 */
export const ACCOUNT_POLICY_VERSION = '2026-08-08-v1';
export const DEEP_SCAN_TERMS_VERSION = '2026-08-12-v3';

/** Domain-control evidence must be renewed before another active scan. */
export const VERIFICATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export const DISPLAY_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export function isValidDisplayHandle(value: string): boolean {
  return DISPLAY_HANDLE_PATTERN.test(value);
}
