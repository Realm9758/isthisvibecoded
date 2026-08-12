export type ApplicationInputKind =
  | 'text'
  | 'search'
  | 'email'
  | 'password'
  | 'number'
  | 'url'
  | 'file'
  | 'hidden'
  | 'other';

export interface ApplicationFormField {
  name: string;
  kind: ApplicationInputKind;
}

export interface ApplicationForm {
  action: string;
  method: 'GET' | 'POST';
  fields: ApplicationFormField[];
  purpose: 'login' | 'search' | 'upload' | 'general';
}

export interface ApplicationQueryInput {
  url: string;
  parameter: string;
  kind: ApplicationInputKind;
  source: 'form' | 'link';
}

export interface ApplicationSurface {
  forms: ApplicationForm[];
  queryInputs: ApplicationQueryInput[];
  sameOriginRoutes: string[];
}

const MAX_FORMS = 12;
const MAX_QUERY_INPUTS = 24;
const MAX_ROUTES = 30;

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2f;/gi, '/')
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)));
}

function attribute(tag: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag)?.[2];
  if (quoted !== undefined) return decodeHtmlAttribute(quoted.trim());
  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag)?.[1];
  return unquoted ? decodeHtmlAttribute(unquoted.trim()) : null;
}

function safeSameOriginUrl(raw: string, pageUrl: URL): URL | null {
  if (!raw || /^(?:javascript|data|mailto|tel):/i.test(raw)) return null;
  try {
    const resolved = new URL(raw, pageUrl);
    if (resolved.origin !== pageUrl.origin || !['http:', 'https:'].includes(resolved.protocol)) return null;
    resolved.hash = '';
    return resolved;
  } catch {
    return null;
  }
}

function inputKind(raw: string | null): ApplicationInputKind {
  const kind = (raw ?? 'text').toLowerCase();
  if (['text', 'search', 'email', 'password', 'number', 'url', 'file', 'hidden'].includes(kind)) {
    return kind as ApplicationInputKind;
  }
  return 'other';
}

function formPurpose(action: URL, fields: readonly ApplicationFormField[]): ApplicationForm['purpose'] {
  const names = fields.map(field => field.name).join(' ');
  if (fields.some(field => field.kind === 'password') || /(?:login|signin|sign-in|session|auth)/i.test(action.pathname)) return 'login';
  if (fields.some(field => field.kind === 'search') || /(?:search|query)/i.test(`${action.pathname} ${names}`)) return 'search';
  if (fields.some(field => field.kind === 'file') || /(?:upload|import|attachment)/i.test(`${action.pathname} ${names}`)) return 'upload';
  return 'general';
}

function routeKey(url: URL): string {
  return `${url.pathname}${url.search}`;
}

/**
 * Builds a bounded, passive inventory from HTML already delivered to a
 * browser. It never invents endpoints, submits forms, or crosses origins.
 */
export function discoverApplicationSurface(pageUrlRaw: string, htmlSources: readonly string[]): ApplicationSurface {
  const pageUrl = new URL(pageUrlRaw);
  const forms: ApplicationForm[] = [];
  const queryInputs: ApplicationQueryInput[] = [];
  const routes = new Set<string>();
  const queryKeys = new Set<string>();

  for (const html of htmlSources) {
    for (const formMatch of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)) {
      if (forms.length >= MAX_FORMS) break;
      const openingTag = `<form${formMatch[1]}>`;
      const action = safeSameOriginUrl(attribute(openingTag, 'action') ?? pageUrl.href, pageUrl);
      if (!action) continue;
      const method = (attribute(openingTag, 'method') ?? 'get').toUpperCase() === 'POST' ? 'POST' : 'GET';
      const fields: ApplicationFormField[] = [];
      const fieldNames = new Set<string>();
      for (const tag of formMatch[2].match(/<(?:input|textarea|select)\b[^>]*>/gi) ?? []) {
        const name = attribute(tag, 'name')?.trim();
        if (!name || name.length > 80 || fieldNames.has(name)) continue;
        fieldNames.add(name);
        fields.push({
          name,
          kind: /^<input\b/i.test(tag) ? inputKind(attribute(tag, 'type')) : 'text',
        });
      }
      if (!fields.length) continue;
      const form: ApplicationForm = { action: action.href, method, fields, purpose: formPurpose(action, fields) };
      forms.push(form);
      routes.add(routeKey(action));
      if (method === 'GET') {
        for (const field of fields) {
          if (field.kind === 'hidden' || field.kind === 'file' || field.kind === 'password') continue;
          const key = `${action.href}\n${field.name}`;
          if (queryKeys.has(key) || queryInputs.length >= MAX_QUERY_INPUTS) continue;
          queryKeys.add(key);
          queryInputs.push({ url: action.href, parameter: field.name, kind: field.kind, source: 'form' });
        }
      }
    }

    for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
      if (routes.size >= MAX_ROUTES && queryInputs.length >= MAX_QUERY_INPUTS) break;
      const href = attribute(tag, 'href');
      const url = href ? safeSameOriginUrl(href, pageUrl) : null;
      if (!url) continue;
      routes.add(routeKey(url));
      for (const parameter of url.searchParams.keys()) {
        if (!parameter || parameter.length > 80 || queryInputs.length >= MAX_QUERY_INPUTS) continue;
        const key = `${url.origin}${url.pathname}\n${parameter}`;
        if (queryKeys.has(key)) continue;
        queryKeys.add(key);
        queryInputs.push({
          url: `${url.origin}${url.pathname}`,
          parameter,
          kind: /(?:url|uri|redirect|next|return|callback|image|src|link)/i.test(parameter) ? 'url' : 'text',
          source: 'link',
        });
      }
    }

    // Modern applications often render forms client-side. Retain concrete
    // same-origin URL literals from their bounded browser bundles so query
    // checks can still target an input the application actually references.
    for (const match of html.matchAll(/["'`]((?:\/|\.\.?\/)[A-Za-z0-9_./~-]{0,180}\?[A-Za-z0-9_%[\].~-]{1,80}=[^"'`\s]{0,160})["'`]/g)) {
      const url = safeSameOriginUrl(match[1], pageUrl);
      if (!url) continue;
      routes.add(routeKey(url));
      for (const parameter of url.searchParams.keys()) {
        if (!parameter || parameter.length > 80 || queryInputs.length >= MAX_QUERY_INPUTS) continue;
        const key = `${url.origin}${url.pathname}\n${parameter}`;
        if (queryKeys.has(key)) continue;
        queryKeys.add(key);
        queryInputs.push({
          url: `${url.origin}${url.pathname}`,
          parameter,
          kind: /(?:url|uri|redirect|next|return|callback|image|src|link)/i.test(parameter) ? 'url' : 'text',
          source: 'link',
        });
      }
    }
  }

  return {
    forms,
    queryInputs,
    sameOriginRoutes: [...routes].slice(0, MAX_ROUTES),
  };
}

export function queryInputsFor(
  surface: ApplicationSurface,
  purpose: 'sql' | 'reflection' | 'redirect' | 'ssrf' | 'traversal' | 'nosql' | 'crlf',
  limit = 6,
): ApplicationQueryInput[] {
  const names: Record<typeof purpose, RegExp> = {
    sql: /^(?:id|user|username|email|account|product|item|order|record|category|page|q|query|search|filter|sort)$/i,
    reflection: /^(?:q|query|search|s|name|message|comment|title|term|keyword|email)$/i,
    redirect: /^(?:redirect|redirect_url|return|return_url|returnUrl|next|url|goto|continue|destination|dest)$/i,
    ssrf: /^(?:url|uri|webhook|callback|proxy|fetch|link|image|src|endpoint|feed)$/i,
    traversal: /^(?:file|filename|path|page|template|include|doc|document|read|view|download)$/i,
    nosql: /^(?:id|user|username|email|account|q|query|search|filter)$/i,
    crlf: /^(?:q|query|search|name|redirect|return|next|url|filename|download)$/i,
  };
  return surface.queryInputs.filter(input => names[purpose].test(input.parameter)).slice(0, Math.max(0, limit));
}
