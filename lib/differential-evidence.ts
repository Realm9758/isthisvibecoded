/**
 * True only when at least one signature is present in the crafted response
 * and absent from the successful control response. Reset lastIndex so this
 * remains deterministic if a future caller supplies a global regexp.
 */
export function hasDifferentialSignature(
  craftedBody: string,
  controlBody: string,
  signatures: readonly RegExp[],
): boolean {
  return signatures.some(signature => {
    signature.lastIndex = 0;
    const craftedMatches = signature.test(craftedBody);
    signature.lastIndex = 0;
    const controlMatches = signature.test(controlBody);
    signature.lastIndex = 0;
    return craftedMatches && !controlMatches;
  });
}

const UNIX_PASSWD_ROOT = /root:[x*]:0:0:[^\r\n]*:[^\r\n]*/;
const UNIX_PASSWD_SECOND_ENTRY = /(?:^|\n)(?:daemon|bin|nobody):[x*]:\d+:\d+:/;

/** Stronger than a single `root:x` fragment, which can occur in examples. */
export function hasUnixPasswdEvidence(body: string): boolean {
  return UNIX_PASSWD_ROOT.test(body) && UNIX_PASSWD_SECOND_ENTRY.test(body);
}

/** Reflection is useful only in an HTML response and only when the exact,
 * request-unique inert element was absent from the benign control. */
export function hasDifferentialHtmlReflection(
  craftedBody: string,
  controlBody: string,
  exactMarkup: string,
  contentType: string,
): boolean {
  return exactMarkup.length >= 24
    && contentType.toLowerCase().includes('text/html')
    && craftedBody.includes(exactMarkup)
    && !controlBody.includes(exactMarkup);
}
