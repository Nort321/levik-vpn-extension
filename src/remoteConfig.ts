/**
 * Announcements and switches from the Levik remote config (/api/app/v1/config).
 * The request is anonymous: no cookie, token or install id, only "extension/<version>".
 */

export interface Announcement {
  id: string;
  level: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  linkUrl: string | null;
  endsAt: number;
}

export interface RemoteConfig {
  fetchedAt: number;
  refreshAfterMs: number;
  flags: Record<string, boolean>;
  announcements: Announcement[];
}

const MAX_BYTES = 32 * 1024;
const MAX_ANNOUNCEMENTS = 10;
const MAX_FLAGS = 64;
const MIN_REFRESH_MS = 5 * 60 * 1000;
const MAX_REFRESH_MS = 6 * 60 * 60 * 1000;
/** A failed request is retried after this long, not on every alarm. */
export const RETRY_AFTER_MS = 10 * 60 * 1000;
export const MAX_DISMISSED = 50;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FLAG = /^[a-z][a-z0-9_]{1,47}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : null;
}

function link(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function announcement(value: unknown, now: number): Announcement | null {
  const item = record(value);
  if (!item || typeof item.id !== 'string' || !ID.test(item.id)) return null;
  if (item.level !== 'info' && item.level !== 'warning' && item.level !== 'critical') return null;
  const title = text(item.title, 80), body = text(item.body, 600);
  const endsAt = typeof item.endsAt === 'string' ? Date.parse(item.endsAt) : NaN;
  if (!title || !body || !Number.isFinite(endsAt) || endsAt <= now) return null;
  return {id: item.id, level: item.level, title, body, linkUrl: link(item.linkUrl), endsAt};
}

/** Keeps what the extension understands and drops anything malformed. */
export function parseRemoteConfig(value: unknown, now = Date.now()): RemoteConfig {
  const document = record(value);
  if (!document || document.ok !== true) throw new Error('serviceError');
  const seconds = typeof document.refreshAfterSeconds === 'number' && Number.isFinite(document.refreshAfterSeconds)
    ? document.refreshAfterSeconds : 0;
  const flags: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(record(document.flags) ?? {}).slice(0, MAX_FLAGS)) {
    const flag = record(item);
    if (FLAG.test(key) && flag && typeof flag.enabled === 'boolean') flags[key] = flag.enabled;
  }
  const announcements = (Array.isArray(document.announcements) ? document.announcements : [])
    .map((item) => announcement(item, now))
    .filter((item): item is Announcement => item !== null)
    .slice(0, MAX_ANNOUNCEMENTS);
  return {
    fetchedAt: now,
    refreshAfterMs: Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, seconds * 1000)),
    flags,
    announcements,
  };
}

export function isConfigDue(config: RemoteConfig | null, failedAt: number | null, now = Date.now()): boolean {
  if (failedAt !== null && now - failedAt < RETRY_AFTER_MS) return false;
  return !config || now - config.fetchedAt >= config.refreshAfterMs;
}

/** Announcements still running that the user has not closed. */
export function visibleAnnouncements(config: RemoteConfig | null, dismissed: readonly string[], now = Date.now()): Announcement[] {
  if (!config) return [];
  const closed = new Set(dismissed);
  return config.announcements.filter((item) => item.endsAt > now && !closed.has(item.id));
}

export function dismiss(dismissed: readonly string[], id: string): string[] {
  if (!ID.test(id)) throw new Error('unknownError');
  return [...dismissed.filter((item) => item !== id), id].slice(-MAX_DISMISSED);
}

export async function fetchRemoteConfig(origin: string, version: string, now = Date.now()): Promise<RemoteConfig> {
  const response = await fetch(`${origin}/api/app/v1/config`, {
    method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
    headers: {Accept: 'application/json', 'X-Levik-Client': `extension/${version}`},
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json') ||
      Number(response.headers.get('content-length') ?? '0') > MAX_BYTES) throw new Error('serviceError');
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new Error('serviceError');
  return parseRemoteConfig(JSON.parse(body), now);
}
