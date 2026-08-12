export type CookieSecurityIssue =
  | 'missing_httponly'
  | 'missing_secure'
  | 'missing_samesite'
  | 'invalid_samesite'
  | 'samesite_none_without_secure'
  | 'invalid_host_prefix'
  | 'invalid_secure_prefix';

export interface CookieSecurityAssessment {
  name: string;
  attributes: string[];
  isAuth: boolean;
  issues: CookieSecurityIssue[];
}

const AUTH_COOKIE_NAME = /(?:^|[._-])(?:session(?:id|token)?|sess|auth(?:entication)?|jwt|access[._-]?token|refresh[._-]?token|id[._-]?token|connect\.sid|phpsessid|jsessionid|aspnetcore\.cookies)(?:$|[._-])/i;

/**
 * Assess one Set-Cookie line without retaining its value. The helper is pure
 * so prefix and SameSite rules stay testable independently of the scanner's
 * HTTP transport.
 */
export function assessSetCookie(header: string): CookieSecurityAssessment | null {
  const firstPart = header.split(';', 1)[0] ?? '';
  const equalsAt = firstPart.indexOf('=');
  if (equalsAt <= 0) return null;

  const name = firstPart.slice(0, equalsAt).trim();
  if (!name) return null;

  const attributes = header
    .split(';')
    .slice(1)
    .map(attribute => attribute.trim().toLowerCase())
    .filter(Boolean);
  const attributeMap = new Map<string, string | null>();
  for (const attribute of attributes) {
    const separator = attribute.indexOf('=');
    if (separator === -1) {
      attributeMap.set(attribute, null);
    } else {
      attributeMap.set(attribute.slice(0, separator).trim(), attribute.slice(separator + 1).trim());
    }
  }

  const normalizedName = name.toLowerCase();
  const authName = normalizedName.replace(/^__(?:host|secure)-/, '');
  const isAuth = authName === '__session' || AUTH_COOKIE_NAME.test(`.${authName}`);
  const hasHttpOnly = attributeMap.has('httponly');
  const hasSecure = attributeMap.has('secure');
  const sameSite = attributeMap.get('samesite');
  const issues: CookieSecurityIssue[] = [];

  if (isAuth && !hasHttpOnly) issues.push('missing_httponly');
  if (!hasSecure) issues.push('missing_secure');
  if (!attributeMap.has('samesite')) {
    issues.push('missing_samesite');
  } else if (sameSite !== 'lax' && sameSite !== 'strict' && sameSite !== 'none') {
    issues.push('invalid_samesite');
  } else if (sameSite === 'none' && !hasSecure) {
    issues.push('samesite_none_without_secure');
  }

  if (
    normalizedName.startsWith('__host-')
    && (!hasSecure || attributeMap.get('path') !== '/' || attributeMap.has('domain'))
  ) {
    issues.push('invalid_host_prefix');
  }
  if (normalizedName.startsWith('__secure-') && !hasSecure) {
    issues.push('invalid_secure_prefix');
  }

  return { name, attributes, isAuth, issues };
}
