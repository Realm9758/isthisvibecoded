/**
 * Bump these identifiers whenever the corresponding user-facing terms change
 * materially. API routes require the exact current value so acceptance cannot
 * be inferred from an old checkbox or a direct, unversioned request.
 */
export const ACCOUNT_POLICY_VERSION = '2026-08-08-v1';
export const DEEP_SCAN_TERMS_VERSION = '2026-08-12-v3';

/** Domain-control evidence must be renewed before another active scan. */
export const VERIFICATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

/*
 * A display handle: letters, numbers, dots, underscores and hyphens, starting
 * with a letter or number, at most 40 characters.
 *
 * The hyphen is escaped deliberately. An HTML `pattern` attribute is compiled
 * with the `v` flag, which reserves `-` inside a character class, so the
 * unescaped form throws at parse time and the browser then enforces no pattern
 * at all: the field silently accepts anything and only the server rejects it.
 * `\-` is valid both here and there, which is what lets the signup form share
 * this definition instead of keeping its own copy that can drift.
 */
export const DISPLAY_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-]{0,39}$/;

/**
 * The same rule as a `pattern` attribute value. HTML anchors the match itself,
 * so the anchors are stripped rather than duplicated.
 */
export const DISPLAY_HANDLE_HTML_PATTERN = DISPLAY_HANDLE_PATTERN.source.replace(/^\^|\$$/g, '');

export function isValidDisplayHandle(value: string): boolean {
  return DISPLAY_HANDLE_PATTERN.test(value);
}
