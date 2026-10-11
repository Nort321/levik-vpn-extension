import {afterEach,describe,expect,it,vi} from 'vitest';
import {ApiEndpoints,fetchInventory} from '../src/apiEndpoints';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('trusted API discovery',()=>{
  it('uses unauthenticated discovery and caches success',async()=>{
    const mock=vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('blocked')).mockResolvedValueOnce(Response.json({ok:true}));
    vi.stubGlobal('fetch',mock);const endpoints=new ApiEndpoints();
    expect(await endpoints.resolve()).toBe('https://api.leviknet.org/api/extension/v1');
    expect(await endpoints.resolve()).toBe('https://api.leviknet.org/api/extension/v1');expect(mock).toHaveBeenCalledTimes(2);
    for(const [,init] of mock.mock.calls){expect(init?.method).toBe('GET');expect(init?.credentials).toBe('omit');expect(init?.redirect).toBe('error');expect(init?.headers).toEqual({Accept:'application/json'});expect(init?.body).toBeUndefined();}
  });
  it('retains the legacy domain if the newer origins fail',async()=>{
    const mock=vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('blocked')).mockRejectedValueOnce(new Error('blocked')).mockResolvedValueOnce(new Response('wrong',{status:503})).mockResolvedValueOnce(Response.json({ok:true}));
    vi.stubGlobal('fetch',mock);expect(await new ApiEndpoints().resolve()).toBe('https://leviknet.com/api/extension/v1');
    expect(mock.mock.calls.map(([url])=>String(url))).toEqual(['https://api.cloudnote-sync.xyz/api/extension/v1/health','https://api.leviknet.org/api/extension/v1/health','https://leviknet.org/api/extension/v1/health','https://leviknet.com/api/extension/v1/health']);
  });
  it.each([new Response('<html>blocked</html>'),Response.json({ok:false}),Response.json({ok:true,padding:'a'.repeat(1024)})])('rejects false health responses',async response=>{
    const mock=vi.fn<typeof fetch>().mockResolvedValueOnce(response).mockResolvedValueOnce(Response.json({ok:true}));vi.stubGlobal('fetch',mock);
    expect(await new ApiEndpoints().resolve()).toBe('https://api.leviknet.org/api/extension/v1');
  });
  it('shares discovery and renews it after invalidation or expiry',async()=>{
    vi.useFakeTimers();const mock=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({ok:true}));vi.stubGlobal('fetch',mock);
    const endpoints=new ApiEndpoints();await Promise.all([endpoints.resolve(),endpoints.resolve()]);expect(mock).toHaveBeenCalledTimes(1);
    endpoints.invalidate();await endpoints.resolve();expect(mock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60001);await endpoints.resolve();expect(mock).toHaveBeenCalledTimes(3);
  });
  it('rejects unavailable endpoints',async()=>{
    vi.stubGlobal('fetch',vi.fn<typeof fetch>().mockRejectedValue(new Error('blocked')));
    await expect(new ApiEndpoints().resolve()).rejects.toThrow('serviceError');
  });
});
it('falls back safely for public read-only inventory',async()=>{
  const mock=vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('blocked')).mockResolvedValueOnce(Response.json({servers:[]}));vi.stubGlobal('fetch',mock);
  expect(await fetchInventory()).toEqual({servers:[]});expect(mock.mock.calls.map(([url])=>String(url))).toEqual(['https://sub.cloudnote-sync.xyz/levik-status/extension/runtime-xray','https://sub.leviknet.org/levik-status/extension/runtime-xray']);
});
