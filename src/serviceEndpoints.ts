/**
 * Where the extension finds the Levik servers. A document signed with the Levik
 * configuration key (config/levik-config-v1.json in the main repository) replaces
 * the built-in host names, so a blocked domain is swapped without a store update.
 * Only a correctly signed document that is not older than the stored one is used.
 */

export interface ServiceEndpoints {
  sequence: number;
  apiOrigins: string[];
  webOrigin: string;
  subscriptionOrigins: string[];
  configUrls: string[];
}

export const BUILT_IN_ENDPOINTS: Readonly<ServiceEndpoints> = Object.freeze({
  sequence: 0,
  apiOrigins: ['https://api.cloudnote-sync.xyz', 'https://api.leviknet.org', 'https://leviknet.org', 'https://leviknet.com'],
  webOrigin: 'https://leviknet.org',
  subscriptionOrigins: ['https://sub.cloudnote-sync.xyz', 'https://sub.leviknet.org'],
  configUrls: [
    'https://api.cloudnote-sync.xyz/downloads/config/levik-config-v1.json',
    'https://api.leviknet.org/downloads/config/levik-config-v1.json',
    'https://raw.githubusercontent.com/Nort321/levik-vpn/main/config/levik-config-v1.json',
    'https://cdn.jsdelivr.net/gh/Nort321/levik-vpn@main/config/levik-config-v1.json',
  ],
});

/** ECDSA P-256 public key (SPKI, base64). */
const CONFIG_PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEBxwZK9Ledu9WcstW72cqoVTP9AjtB5dzNIhqmvTlm0lXRaqspdY1KbwCnzhjgCY10hAi9CL37PxhY/GGaIdAdQ==';
const STORAGE_KEY = 'serviceEndpoints';
const CHECKED_KEY = 'serviceEndpointsCheckedAt';
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_DOCUMENT_BYTES = 16 * 1024;
const MAX_SIGNATURE_BYTES = 512;
const MAX_ITEMS = 8;
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const LEGACY_HOSTS = ['leviknet.com', 'sub.leviknet.com', 'leviknet.org', 'api.leviknet.org', 'sub.leviknet.org'];

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function base64(value: Uint8Array): string {
  let text = '';
  for (const byte of value) text += String.fromCharCode(byte);
  return btoa(text);
}

let configKey: Promise<CryptoKey> | null = null;

function importConfigKey(): Promise<CryptoKey> {
  configKey ??= crypto.subtle.importKey('spki', bytes(CONFIG_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return configKey;
}

/** WebCrypto expects r||s; the publisher writes DER (as OpenSSL does). */
export function derToP1363(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  let offset = 0;
  const read = () => der[offset++];
  if (read() !== 0x30) return null;
  const total = read();
  if (total === undefined || total & 0x80 || total + 2 !== der.length) return null;
  const output = new Uint8Array(64);
  for (const position of [0, 32]) {
    if (read() !== 0x02) return null;
    let length = read();
    if (length === undefined || length < 1 || length > 33 || offset + length > der.length) return null;
    while (length > 32 && der[offset] === 0) { offset++; length--; }
    if (length > 32) return null;
    output.set(der.subarray(offset, offset + length), position + 32 - length);
    offset += length;
  }
  return offset === der.length ? output : null;
}

function cleanOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !HOST.test(url.hostname) || url.port || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function cleanConfigUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !HOST.test(url.hostname) || url.port || url.username || url.password ||
        url.search || url.hash || !url.pathname.endsWith('.json')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function list(values: unknown, clean: (value: unknown) => string | null): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.flatMap((value) => clean(value) ?? []))].slice(0, MAX_ITEMS);
}

/** Verifies the signature over the exact bytes, then the content. Null when anything is off. */
export async function verifyEndpointsDocument(
  body: Uint8Array<ArrayBuffer>,
  signature: string,
  key?: CryptoKey,
): Promise<ServiceEndpoints | null> {
  if (body.length === 0 || body.length > MAX_DOCUMENT_BYTES || signature.length > MAX_SIGNATURE_BYTES) return null;
  const encoded = signature.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  try {
    const raw = derToP1363(bytes(encoded));
    if (!raw) return null;
    const verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key ?? await importConfigKey(), raw, body);
    if (!verified) return null;
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const document = value as Record<string, unknown>;
    if (document.schema !== 1) return null;
    const sequence = document.sequence;
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) return null;
    const apiOrigins = list(document.apiOrigins, cleanOrigin);
    const webOrigin = cleanOrigin(document.webOrigin);
    if (!apiOrigins.length || !webOrigin) return null;
    return {
      sequence,
      apiOrigins,
      webOrigin,
      subscriptionOrigins: list(document.subscriptionOrigins, cleanOrigin),
      configUrls: list(document.configUrls, cleanConfigUrl),
    };
  } catch {
    return null;
  }
}

/** The document's hosts come first; the built-in ones stay as a last resort. */
function merged(document: ServiceEndpoints): ServiceEndpoints {
  return {
    sequence: document.sequence,
    apiOrigins: [...new Set([...document.apiOrigins, ...BUILT_IN_ENDPOINTS.apiOrigins])],
    webOrigin: document.webOrigin,
    subscriptionOrigins: [...new Set([...document.subscriptionOrigins, ...BUILT_IN_ENDPOINTS.subscriptionOrigins])],
    configUrls: [...new Set([...document.configUrls, ...BUILT_IN_ENDPOINTS.configUrls])],
  };
}

let current: ServiceEndpoints = merged(BUILT_IN_ENDPOINTS);

export function serviceEndpoints(): Readonly<ServiceEndpoints> {
  return current;
}

export function useEndpointsDocument(document: ServiceEndpoints | null): void {
  current = merged(document ?? BUILT_IN_ENDPOINTS);
}

/** Levik website origins accepted for sign-in pages. */
export function websiteOrigins(): ReadonlySet<string> {
  return new Set(['https://leviknet.org', 'https://leviknet.com', current.webOrigin]);
}

/** Levik service hosts that must never go through the extension's own proxy. */
export function serviceHosts(): string[] {
  const hosts = new Set(LEGACY_HOSTS);
  for (const origin of [...current.apiOrigins, ...current.subscriptionOrigins, current.webOrigin]) hosts.add(new URL(origin).hostname);
  return [...hosts];
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!response.ok || Number(response.headers.get('content-length') ?? '0') > limit) return null;
  const value = new Uint8Array(await response.arrayBuffer());
  return value.length > limit ? null : value;
}

/** Downloads the first valid document that is at least as new as `minSequence`. */
export async function fetchEndpointsDocument(
  urls: readonly string[],
  minSequence: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ document: ServiceEndpoints; body: Uint8Array<ArrayBuffer>; signature: string } | null> {
  const get = (url: string, limit: number) => fetchImpl(url, {
    method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
  }).then((response) => readLimited(response, limit));
  for (const url of urls) {
    try {
      const [body, signature] = await Promise.all([get(url, MAX_DOCUMENT_BYTES), get(`${url}.sig`, MAX_SIGNATURE_BYTES)]);
      if (!body || !signature) continue;
      const text = new TextDecoder().decode(signature);
      const document = await verifyEndpointsDocument(body, text);
      if (document && document.sequence >= minSequence) return { document, body, signature: text };
    } catch { /* A blocked or broken mirror: try the next one. */ }
  }
  return null;
}

/** Signed bytes from storage, verified again so an edited copy cannot redirect the extension. */
export async function loadEndpoints(storage?: chrome.storage.StorageArea): Promise<void> {
  try {
    const value = (await (storage ?? chrome.storage.local).get([STORAGE_KEY]))[STORAGE_KEY] as unknown;
    if (typeof value !== 'object' || value === null) return;
    const { body, signature } = value as Record<string, unknown>;
    if (typeof body !== 'string' || typeof signature !== 'string') return;
    useEndpointsDocument(await verifyEndpointsDocument(bytes(body), signature));
  } catch { /* No stored document: the built-in hosts apply. */ }
}

let refreshing: Promise<boolean> | null = null;
let lastAttemptAt = 0;

/** Looks for a newer document; true when the hosts changed. */
export function refreshEndpoints(
  minIntervalMs = 0,
  storage?: chrome.storage.StorageArea,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (refreshing) return refreshing;
  if (Date.now() - lastAttemptAt < minIntervalMs) return Promise.resolve(false);
  lastAttemptAt = Date.now();
  refreshing = (async () => {
    const before = current;
    const fetched = await fetchEndpointsDocument(before.configUrls, Math.max(1, before.sequence), fetchImpl);
    if (!fetched || (fetched.document.sequence === before.sequence && before.sequence > 0)) return false;
    useEndpointsDocument(fetched.document);
    await (storage ?? chrome.storage.local).set({ [STORAGE_KEY]: { body: base64(fetched.body), signature: fetched.signature } });
    return true;
  })().catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * Twice-daily check that survives worker restarts: the time of the last
 * attempt is stored, not kept in memory.
 */
export async function refreshEndpointsIfDue(
  storage: chrome.storage.StorageArea = chrome.storage.local,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const checked = (await storage.get([CHECKED_KEY]))[CHECKED_KEY] as unknown;
  if (typeof checked === 'number' && Date.now() - checked < CHECK_INTERVAL_MS && checked <= Date.now()) return false;
  await storage.set({ [CHECKED_KEY]: Date.now() });
  return refreshEndpoints(0, storage, fetchImpl);
}
