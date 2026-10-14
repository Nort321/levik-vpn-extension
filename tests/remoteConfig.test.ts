import {afterEach,describe,expect,it,vi} from 'vitest';
import {dismiss,fetchRemoteConfig,isConfigDue,parseRemoteConfig,RETRY_AFTER_MS,visibleAnnouncements} from '../src/remoteConfig';
afterEach(()=>{vi.unstubAllGlobals();});
const now=Date.parse('2026-10-14T12:00:00Z');
const id='5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const item=(overrides:Record<string,unknown>={})=>({id,level:'warning',title:'Работы на сервере',body:'Германия недоступна до 14:00.',linkUrl:'https://leviknet.org/status',notify:true,startsAt:'2026-10-14T10:00:00Z',endsAt:'2026-10-14T14:00:00Z',...overrides});
describe('remote config',()=>{
  it('keeps valid announcements and flags',()=>{
    const config=parseRemoteConfig({ok:true,refreshAfterSeconds:900,flags:{new_popup:{enabled:true,rolloutPercent:100},'Bad Key':{enabled:true}},announcements:[item()],protocols:null},now);
    expect(config).toEqual({fetchedAt:now,refreshAfterMs:900000,flags:{new_popup:true},announcements:[{id,level:'warning',title:'Работы на сервере',body:'Германия недоступна до 14:00.',linkUrl:'https://leviknet.org/status',endsAt:Date.parse('2026-10-14T14:00:00Z')}]});
  });
  it.each([
    item({id:'not-a-uuid'}),item({level:'urgent'}),item({title:''}),item({body:'x'.repeat(601)}),item({endsAt:'2026-10-14T11:00:00Z'}),item({endsAt:'soon'}),
  ])('drops a malformed or finished announcement',bad=>{
    expect(parseRemoteConfig({ok:true,announcements:[bad]},now).announcements).toEqual([]);
  });
  it('opens only plain https links',()=>{
    for(const linkUrl of ['http://leviknet.org','javascript:alert(1)','https://user:pass@leviknet.org/'])expect(parseRemoteConfig({ok:true,announcements:[item({linkUrl})]},now).announcements[0]?.linkUrl).toBeNull();
  });
  it('bounds the refresh interval and rejects other documents',()=>{
    expect(parseRemoteConfig({ok:true,refreshAfterSeconds:1},now).refreshAfterMs).toBe(300000);
    expect(parseRemoteConfig({ok:true,refreshAfterSeconds:1e9},now).refreshAfterMs).toBe(21600000);
    expect(()=>parseRemoteConfig({ok:false},now)).toThrow('serviceError');
    expect(()=>parseRemoteConfig([],now)).toThrow('serviceError');
  });
  it('waits after a failure and until the server interval passes',()=>{
    const config=parseRemoteConfig({ok:true,refreshAfterSeconds:900},now);
    expect(isConfigDue(null,null,now)).toBe(true);
    expect(isConfigDue(null,now-1000,now)).toBe(false);
    expect(isConfigDue(null,now-RETRY_AFTER_MS,now)).toBe(true);
    expect(isConfigDue(config,null,now+899000)).toBe(false);
    expect(isConfigDue(config,null,now+900000)).toBe(true);
  });
  it('hides closed and expired announcements',()=>{
    const config=parseRemoteConfig({ok:true,announcements:[item()]},now);
    expect(visibleAnnouncements(config,[],now)).toHaveLength(1);
    expect(visibleAnnouncements(config,dismiss([],id),now)).toEqual([]);
    expect(visibleAnnouncements(config,[],Date.parse('2026-10-14T14:00:01Z'))).toEqual([]);
    expect(()=>dismiss([],'<script>')).toThrow('unknownError');
    expect(dismiss(Array.from({length:60},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`),id)).toHaveLength(50);
  });
  it('asks anonymously with the extension client header',async()=>{
    const mock=vi.fn<typeof fetch>().mockResolvedValue(Response.json({ok:true,announcements:[]}));vi.stubGlobal('fetch',mock);
    await fetchRemoteConfig('https://api.leviknet.org','1.0.7',now);
    const [url,init]=mock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.leviknet.org/api/app/v1/config');
    expect(init?.credentials).toBe('omit');expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({Accept:'application/json','X-Levik-Client':'extension/1.0.7'});
  });
  it('rejects oversized or non-JSON responses',async()=>{
    vi.stubGlobal('fetch',vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('<html>'))
      .mockResolvedValueOnce(Response.json({ok:true,padding:'a'.repeat(40000)})));
    await expect(fetchRemoteConfig('https://api.leviknet.org','1.0.7',now)).rejects.toThrow('serviceError');
    await expect(fetchRemoteConfig('https://api.leviknet.org','1.0.7',now)).rejects.toThrow('serviceError');
  });
});
