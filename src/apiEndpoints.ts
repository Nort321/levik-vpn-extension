const ORIGINS = ['https://api.leviknet.org', 'https://leviknet.org', 'https://leviknet.com'] as const;

export class ApiEndpoints {
  private selected: string | null = null;
  private verifiedUntil = 0;
  private pending: Promise<string> | null = null;

  invalidate(): void { this.selected = null; this.verifiedUntil = 0; }

  async resolve(): Promise<string> {
    if (this.selected && Date.now() < this.verifiedUntil) return this.selected;
    if (!this.pending) this.pending = this.probe().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async probe(): Promise<string> {
    for (const origin of ORIGINS) {
      try {
        // Discover availability without credentials. Never replay a possibly completed POST.
        const response = await fetch(`${origin}/api/extension/v1/health`, {
          method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000),
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json') ||
            Number(response.headers.get('content-length') ?? '0') > 1024) continue;
        const body = await response.text();
        if (body.length > 1024) continue;
        const value: unknown = JSON.parse(body);
        if (typeof value !== 'object' || value === null || !('ok' in value) || value.ok !== true) continue;
        this.selected = `${origin}/api/extension/v1`;
        this.verifiedUntil = Date.now() + 60000;
        return this.selected;
      } catch { /* Only the built-in trusted HTTPS origins are considered. */ }
    }
    throw new Error('serviceError');
  }
}

export async function fetchInventory(): Promise<unknown> {
  for (const origin of ['https://sub.leviknet.org', 'https://sub.leviknet.com:2095']) {
    try {
      const response = await fetch(`${origin}/levik-status/extension/runtime-xray`, {
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (response.ok) return await response.json();
    } catch { /* Inventory is public and read-only, so a legacy retry is safe. */ }
  }
  throw new Error('locationsUnavailable');
}
