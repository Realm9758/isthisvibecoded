import type { DeepFindingSeverity } from '@/types/deep-scan';

export interface SensitiveFileEvidence {
  evidence: string;
  severity?: DeepFindingSeverity;
  description?: string;
}

export interface StripeSecretEvidence {
  redacted: string;
  severity: 'critical' | 'high';
  title: string;
  description: string;
}

export interface GenericClientKeyEvidence {
  redacted: string;
}

const SECRET_ENV_NAME = /^(?:JWT_SECRET|API_SECRET|SECRET_KEY|PRIVATE_KEY|STRIPE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|AWS_SECRET_ACCESS_KEY|[A-Z0-9_]*(?:PASSWORD|PRIVATE_KEY|CLIENT_SECRET|ACCESS_TOKEN|AUTH_TOKEN|SERVICE_ROLE_KEY|API_KEY))$/;
const PUBLIC_ENV_PREFIX = /^(?:NEXT_PUBLIC_|VITE_|PUBLIC_)/;
const PLACEHOLDER_VALUE = /^(?:change-?me|example|placeholder|replace-?me|test|your[-_].*|x{8,}|\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|<%=?[\s\S]*?%>|\{\{[\s\S]*?\}\}|process\.env(?:\.[A-Z_][A-Z0-9_]*|\[["'][^"']+["']\])|ENV(?:\.fetch\s*\([\s\S]*\)|\[["'][^"']+["']\]))$/i;

function meaningfulValue(rawValue: string): string | null {
  const value = rawValue.replace(/^["']|["']$/g, '').trim();
  return value.length >= 8 && !PLACEHOLDER_VALUE.test(value) ? value : null;
}

/** A generic key-shaped assignment is review context only. Evaluate each
 * candidate independently so one unrelated placeholder cannot suppress a
 * later material-looking value elsewhere in a bundle. */
export function findGenericClientKeyEvidence(html: string): GenericClientKeyEvidence | null {
  const matches = html.matchAll(
    /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*["']([A-Za-z0-9_-]{20,})["']/gi,
  );
  for (const match of matches) {
    const value = match[1];
    if (!meaningfulValue(value)) continue;
    if (/(?:replace|placeholder|example|your[_-]?(?:api[_-]?)?key)/i.test(value)) continue;
    return { redacted: `${value.slice(0, 4)}...${value.slice(-4)}` };
  }
  return null;
}

function environmentEvidence(body: string): SensitiveFileEvidence | null {
  let assignments = 0;
  let infrastructureValue = false;
  // A file whose credential-bearing keys all hold placeholders is a template
  // such as .env.example. Those are published on purpose, so reporting one as
  // an exposure is noise that trains people to ignore the finding.
  let templatePlaceholder = false;
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!match) continue;
    assignments++;
    const value = meaningfulValue(match[2]);
    const isSecretName = SECRET_ENV_NAME.test(match[1]) && !PUBLIC_ENV_PREFIX.test(match[1]);
    if (!value) {
      if (isSecretName || match[1] === 'DATABASE_URL') {
        templatePlaceholder = true;
      }
      continue;
    }
    if (isSecretName) {
      return { evidence: `${assignments} or more environment assignments including a non-placeholder secret value detected` };
    }
    if (match[1] === 'DATABASE_URL') {
      try {
        const databaseUrl = new URL(value);
        if (databaseUrl.username || databaseUrl.password) {
          return { evidence: 'A database URL containing embedded credentials was detected' };
        }
        infrastructureValue = true;
      } catch {
        // An unparseable value is not enough to claim a credential exposure.
      }
    }
  }
  if (infrastructureValue) {
    return {
      evidence: 'An uncredentialed database endpoint was detected; no password or token was confirmed',
      severity: 'medium',
      description: 'An environment file reveals database connection metadata, but this response did not confirm embedded database credentials.',
    };
  }
  if (templatePlaceholder) return null;
  if (assignments >= 2) {
    return {
      evidence: `${assignments} non-secret environment assignments detected`,
      severity: 'info',
      description: 'An environment-shaped configuration file is public, but no non-placeholder secret value was confirmed.',
    };
  }
  return null;
}

/** Pure content validation used by the active scanner and its fixtures. */
export function validateSensitiveFileEvidence(
  path: string,
  body: string,
  contentType: string,
): SensitiveFileEvidence | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  // Content-Type is frequently inherited from a catch-all server default. A
  // real markup signature is a stronger reason to reject a response than a
  // text/html label on an otherwise valid plain configuration file.
  const looksHtml = /<!doctype\s+html|<html\b|<body\b/i.test(trimmed.slice(0, 4_000));
  void contentType;

  if (path === '/phpinfo.php' || path === '/info.php') {
    return /phpinfo\(\)|<title>php\s*\d|PHP Version/i.test(trimmed)
      ? { evidence: 'phpinfo output markers detected' }
      : null;
  }
  if (looksHtml) return null;

  if (path.startsWith('/.env')) {
    return environmentEvidence(trimmed);
  }
  if (path === '/.git/config') {
    if (!/^\s*\[core\]/m.test(trimmed) || !/repositoryformatversion|\[remote\s+"origin"\]/i.test(trimmed)) {
      return null;
    }
    const credentialedRemote = /url\s*=\s*https?:\/\/[^\s:@]+:[^\s@]+@/i.test(trimmed);
    return credentialedRemote
      ? { evidence: 'Git configuration syntax and an embedded remote credential were detected' }
      : {
          evidence: 'Git configuration syntax detected; no embedded remote credential was confirmed',
          severity: 'info',
          description: 'Git repository metadata is publicly readable. This response can reveal a remote URL, but it did not establish that repository objects or credentials are downloadable.',
        };
  }
  if (path === '/.git/HEAD') {
    return /^(?:ref:\s+refs\/(?:heads|tags)\/[^\s]+|[a-f0-9]{40})$/i.test(trimmed)
      ? {
          evidence: 'Git HEAD reference detected; repository objects were not tested by this response',
          severity: 'info',
          description: 'A Git HEAD reference is publicly readable. This is useful hardening evidence, but HEAD alone does not prove that source code can be reconstructed.',
        }
      : null;
  }
  if (path === '/wp-config.php') {
    return /<\?php/i.test(trimmed) && /DB_(?:NAME|USER|PASSWORD|HOST)|AUTH_KEY|SECURE_AUTH_KEY/i.test(trimmed)
      ? { evidence: 'WordPress configuration constants detected' }
      : null;
  }
  if (path.endsWith('.sql')) {
    const dumpHeader = /--\s+(?:MySQL|PostgreSQL).*dump/i.test(trimmed);
    const containsRows = /(?:INSERT\s+INTO|COPY\s+[^\s]+\s+FROM)/i.test(trimmed);
    if (containsRows) {
      return { evidence: 'SQL dump or data-row syntax detected' };
    }
    if (/CREATE\s+TABLE/i.test(trimmed)) {
      return {
        evidence: 'SQL schema syntax detected; no data rows were confirmed',
        severity: 'medium',
        description: 'A database schema file is publicly accessible. It can reveal table and column structure, but this response did not confirm exposed database rows or credentials.',
      };
    }
    if (dumpHeader) {
      return {
        evidence: 'A database-dump header was detected; no schema or data rows were confirmed',
        severity: 'info',
        description: 'A response resembles the header of a database dump, but this bounded response did not confirm schema or row exposure.',
      };
    }
    return null;
  }
  if (path === '/.htaccess') {
    return /^(?:RewriteEngine|RewriteRule|Options|AuthType|Require|Deny\s+from)\b/im.test(trimmed)
      ? { evidence: 'Apache configuration directives detected' }
      : null;
  }
  if (path === '/config.json' || path === '/storage.json') {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object') return null;
      const hasMeaningfulSensitiveValue = (value: unknown): boolean => {
        if (Array.isArray(value)) return value.some(hasMeaningfulSensitiveValue);
        if (!value || typeof value !== 'object') return false;
        return Object.entries(value).some(([key, child]) => {
          const sensitiveKey = /^(?:password|passwd|secret|private[_-]?key|access[_-]?token|credential|database[_-]?(?:url|uri))$/i.test(key);
          if (sensitiveKey && typeof child === 'string' && meaningfulValue(child)) return true;
          return hasMeaningfulSensitiveValue(child);
        });
      };
      return hasMeaningfulSensitiveValue(parsed)
        ? { evidence: 'A sensitive configuration key with a non-placeholder value was detected' }
        : null;
    } catch {
      return null;
    }
  }
  if (path === '/.DS_Store') return body.includes('Bud1') ? { evidence: 'DS_Store binary signature detected' } : null;
  if (path === '/.npmrc') {
    const credential = /(?:_authToken|_auth|password)\s*=\s*([^\s#]+)/i.exec(trimmed)?.[1];
    return credential && meaningfulValue(credential) ? { evidence: 'npm credential directive with a non-placeholder value detected' } : null;
  }
  if (path === '/docker-compose.yml') {
    if (!/^\s*services\s*:/m.test(trimmed) || !/^\s+(?:image|build)\s*:/m.test(trimmed)) return null;
    const inlineSecret = /^\s+(?:password|secret|token|api[_-]?key)\s*:\s*(\S.*?)\s*$/im.exec(trimmed)?.[1];
    return inlineSecret && meaningfulValue(inlineSecret)
      ? { evidence: 'Docker Compose structure with a non-placeholder secret-shaped value detected' }
      : {
          evidence: 'Docker Compose structure detected; no material secret value was confirmed',
          severity: 'info',
          description: 'A Docker Compose file exposes infrastructure metadata. No material credential was confirmed in the bounded response.',
        };
  }
  if (path === '/Dockerfile') {
    if (!/^\s*FROM\s+\S+/im.test(trimmed)) return null;
    const inlineSecret = /^\s*(?:ARG|ENV)\s+(?:\w*(?:PASSWORD|SECRET|TOKEN|API_KEY)\w*)[=\s]+(.+?)\s*$/im.exec(trimmed)?.[1];
    return inlineSecret && meaningfulValue(inlineSecret)
      ? { evidence: 'Dockerfile syntax with a non-placeholder secret-shaped build value detected' }
      : {
          evidence: 'Dockerfile syntax detected; no material secret value was confirmed',
          severity: 'info',
          description: 'A Dockerfile exposes build and base-image metadata. No material credential was confirmed in the bounded response.',
        };
  }
  if (path === '/.travis.yml') {
    if (!/^\s*(?:language|script|deploy)\s*:/m.test(trimmed)) return null;
    return {
      evidence: 'Travis CI configuration syntax detected; no material secret value was confirmed',
      severity: 'info',
      description: 'A CI configuration file exposes pipeline metadata. This response did not confirm a deploy credential or other material secret.',
    };
  }
  if (path === '/config/database.yml') {
    if (!/^\s*adapter\s*:/m.test(trimmed) || !/^\s*(?:database|username|password)\s*:/m.test(trimmed)) return null;
    const password = /^\s*password\s*:\s*(.+?)\s*$/im.exec(trimmed)?.[1];
    return password && meaningfulValue(password)
      ? { evidence: 'Rails database configuration with a non-placeholder password detected' }
      : {
          evidence: 'Rails database configuration syntax detected; no material password was confirmed',
          severity: 'medium',
          description: 'A Rails database configuration file exposes connection metadata, but this response did not confirm a material database password.',
        };
  }
  return null;
}

function isObviousPlaceholder(value: string): boolean {
  const suffix = value.replace(/^sk_(?:live|test)_/, '');
  return /^(?:x+|0+|1+|a+|test+|example+|placeholder+)$/i.test(suffix)
    || /(?:replace|your[_-]?key|example|placeholder)/i.test(suffix);
}

/** Classify client-visible Stripe secrets without conflating test and live access. */
export function findStripeSecretEvidence(html: string): StripeSecretEvidence | null {
  const matches = [...html.matchAll(/sk_(live|test)_[A-Za-z0-9]{24,}/g)]
    .filter(match => !isObviousPlaceholder(match[0]));
  const match = matches.find(candidate => candidate[1] === 'live') ?? matches[0];
  if (!match) return null;

  const mode = match[1];
  const redacted = `sk_${mode}_...${match[0].slice(-6)}`;
  if (mode === 'live') {
    return {
      redacted,
      severity: 'critical',
      title: 'Stripe Live Secret Key Exposed in Client HTML',
      description: 'A Stripe live-mode secret key appears in client HTML. It can authenticate live-mode API calls within the key permissions, potentially exposing or changing customer and payment data.',
    };
  }

  return {
    redacted,
    severity: 'high',
    title: 'Stripe Test Secret Key Exposed in Client HTML',
    description: 'A Stripe test-mode secret key appears in client HTML. It can expose or change test-mode resources, but it does not by itself grant access to live customers or charges.',
  };
}
