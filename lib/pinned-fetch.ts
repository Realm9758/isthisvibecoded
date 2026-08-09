import 'server-only';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { resolvePublicTarget, type PublicTargetAddress } from './url-safety';

const ALLOWED_PORTS = new Set(['', '80', '443']);
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;

export type PinnedFetchInit = RequestInit & {
  /** Hard transport-level cap; callers may impose a smaller semantic limit. */
  maxResponseBytes?: number;
};

async function abortable<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      value => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

function pinnedLookup(target: PublicTargetAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [target]);
      return;
    }
    callback(null, target.address, target.family);
  };
}

async function requestBody(body: RequestInit['body']): Promise<string | Uint8Array | undefined> {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new Error('Unsupported request body for pinned outbound fetch');
}

async function requestPinnedAddress(
  url: URL,
  target: PublicTargetAddress,
  init: PinnedFetchInit,
  body: string | Uint8Array | undefined,
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (body !== undefined && !headers.has('content-length') && !headers.has('transfer-encoding')) {
    headers.set(
      'content-length',
      String(typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength),
    );
  }
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const transport = url.protocol === 'https:' ? requestHttps : requestHttp;

  return new Promise<Response>((resolve, reject) => {
    const req = transport({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: Object.fromEntries(headers.entries()),
      lookup: pinnedLookup(target),
      // Keep certificate validation and SNI tied to the requested hostname,
      // even when a probe deliberately supplies a different Host header.
      servername: isIP(hostname) ? undefined : hostname,
      signal: init.signal ?? undefined,
    }, incoming => {
      const status = incoming.statusCode ?? 0;
      if (status < 200 || status > 599) {
        incoming.destroy();
        reject(new Error(`Unsupported upstream HTTP status ${status}`));
        return;
      }

      const responseHeaders = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      }

      const statusHasNoBody = method === 'HEAD' || status === 204 || status === 205 || status === 304;
      const chunks: Buffer[] = [];
      let received = 0;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        incoming.destroy();
        reject(error);
      };

      incoming.on('data', (chunk: Buffer) => {
        if (statusHasNoBody || settled) return;
        received += chunk.byteLength;
        if (received > (init.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)) {
          fail(new Error('Outbound response exceeded the configured byte limit'));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on('error', error => fail(error));
      incoming.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(new Response(statusHasNoBody ? null : Buffer.concat(chunks), {
          status,
          statusText: incoming.statusMessage,
          headers: responseHeaders,
        }));
      });
      // Flow the IncomingMessage even when the protocol says no body. This
      // releases the socket deterministically instead of leaving it paused.
      incoming.resume();
    });
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Fetch one public URL without a DNS validation/connection race. Every DNS
 * answer is checked, and the socket lookup is then pinned to one checked IP.
 * Redirect handling remains the caller's responsibility.
 */
export async function pinnedFetch(urlInput: URL | string, init: PinnedFetchInit = {}): Promise<Response> {
  const url = urlInput instanceof URL ? new URL(urlInput.href) : new URL(urlInput);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs can be fetched');
  }
  if (url.username || url.password) throw new Error('Outbound URLs cannot contain credentials');
  if (!ALLOWED_PORTS.has(url.port)) throw new Error('Only standard web ports 80 and 443 are allowed');

  const targets = await abortable(resolvePublicTarget(url), init.signal);
  const body = await requestBody(init.body);
  let lastError: unknown;
  for (const target of targets) {
    try {
      return await requestPinnedAddress(url, target, init, body);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not connect to a validated public address');
}
