/**
 * The canonical origin, in one place.
 *
 * Ironclad is served at bhopstudio.com/ironclad rather than on its own domain,
 * so NEXT_PUBLIC_APP_URL carries a path as well as a host, and everything else
 * is derived from it: the Next.js basePath, the auth cookie's scope, Stripe's
 * return URLs, and the address the scanner advertises.
 *
 * Deriving them all from one value is what stops the deployment from drifting
 * into a state where, say, the cookie is scoped to a path the app no longer
 * serves. Set it per environment and nothing else needs to know.
 *
 *   local        http://localhost:3000
 *   production   https://bhopstudio.com/ironclad
 */

const FALLBACK = 'https://bhopstudio.com/ironclad';

function normalise(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Absolute, no trailing slash. Includes the path prefix when there is one. */
export const SITE_ORIGIN: string = process.env.NEXT_PUBLIC_APP_URL
  ? normalise(process.env.NEXT_PUBLIC_APP_URL)
  : FALLBACK;

function parsed(): URL {
  try {
    return new URL(SITE_ORIGIN);
  } catch {
    return new URL(FALLBACK);
  }
}

/** Hostname alone, for display and for the scanner's outbound identifiers. */
export const SITE_HOST: string = parsed().host;

/**
 * The path prefix, or an empty string when the app owns its whole origin.
 *
 * This is the same value next.config.ts uses for basePath, derived from the
 * same variable rather than written down twice.
 */
export const SITE_BASE_PATH: string = (() => {
  const path = parsed().pathname.replace(/\/+$/, '');
  return path === '' || path === '/' ? '' : path;
})();

/**
 * Scope for the auth cookie.
 *
 * On a shared domain this keeps the session out of requests to the sibling
 * apps on the same host. Path is not a security boundary in cookies, so this
 * reduces incidental exposure rather than isolating anything: a sibling app is
 * still same-origin and could read it. The real protection is that only this
 * app is served under the prefix.
 */
export const SITE_COOKIE_PATH: string = SITE_BASE_PATH || '/';

/**
 * The page a site owner reaches from the scanner user agent.
 *
 * Always absolute, and always the deployed origin rather than a relative path:
 * it is read out of a log file, not clicked in a browser.
 */
export const SCANNER_INFO_URL = `${SITE_ORIGIN}/scanner`;

/** Absolute URL for an in-app path, prefix included. */
export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Same-origin path for a client-side fetch.
 *
 * Next's basePath rewrites <Link>, the router and static assets, but it does
 * not touch fetch(). Under a path prefix a bare fetch('/api/...') leaves the
 * zone entirely and hits the parent domain, which knows nothing about it. Any
 * client call to our own API has to go through here.
 */
export function apiPath(path: string): string {
  return `${SITE_BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}
