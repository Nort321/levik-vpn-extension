import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {defaults,emptyTraffic,type State,type PublicState} from '../src/model';

type Reply={ok:boolean;state?:PublicState;error?:string};
type MessageListener=(message:unknown,sender:chrome.runtime.MessageSender,respond:(value:Reply)=>void)=>boolean;
const onMessage=vi.fn<(listener:MessageListener)=>void>();
const onAlarm=vi.fn<(listener:()=>void)=>void>();
const onProxyError=vi.fn<(listener:(details:{fatal:boolean;error:string})=>void)=>void>();
const persist=vi.fn<(value:{state?:State})=>Promise<void>>();
const proxyClear=vi.fn((_options:unknown,callback:()=>void)=>callback());
const fetchMock=vi.fn<typeof fetch>();
const pairing={requestId:'request-fixture',pollToken:'poll-secret-fixture',expiresAt:Date.now()+300000,verificationUri:'https://leviknet.com/login?next=%2Fdashboard%2Faccount-extension'};
const session={token:'test-session-token-with-at-least-32-characters',label:'Test user',plan:'trial',expiresAt:Date.now()+72*3600000,endpoint:{host:'proxy.example.org',port:8443,username:'fixture',password:'fixture'},locationId:'node',locations:[{id:'node',country:'DE',city:'',flag:'de',region:'europe',available:true,latency:null}]};
let stored:State;
let pollResult:unknown;
let pollFails:boolean;
const extensionUrl='chrome-extension://fixture/';
async function message(type:string,extra:Record<string,unknown>={}):Promise<Reply>{
  const listener=onMessage.mock.calls[0]?.[0];
  if(!listener)throw new Error('Missing message listener');
  return new Promise(resolve=>listener({type,...extra},{id:'fixture',url:`${extensionUrl}popup.html`},resolve));
}
async function start(){await import('../src/background');}
const polls=()=>fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/pair/poll'));
beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();vi.clearAllMocks();
  stored={locations:[],preferences:{...defaults},session:null,connected:false,connectedAt:null,traffic:emptyTraffic(),trafficBaseline:null,error:null,trialUsed:false};
  pollResult={pending:true};pollFails=false;
  persist.mockImplementation(async value=>{if(value.state)stored=structuredClone(value.state);});
  const event={addListener:vi.fn()};
  const clear=vi.fn((_options:unknown,callback:()=>void)=>callback());
  vi.stubGlobal('chrome',{
    storage:{local:{setAccessLevel:vi.fn(),get:vi.fn(async()=>({state:stored})),set:persist,remove:vi.fn()}},
    i18n:{getUILanguage:()=> 'en'},alarms:{create:vi.fn(),onAlarm:{addListener:onAlarm}},
    action:{setBadgeText:vi.fn(),setBadgeBackgroundColor:vi.fn()},
    runtime:{id:'fixture',getManifest:()=>({version:'1.0.7'}),getURL:(path:string)=>extensionUrl+path,onMessage:{addListener:onMessage},onStartup:event},
    tabs:{create:vi.fn()},proxy:{settings:{clear:proxyClear,get:(_options:unknown,callback:(value:unknown)=>void)=>callback({levelOfControl:'controlled_by_this_extension'}),onChange:event},onProxyError:{addListener:onProxyError}},
    privacy:{network:{webRTCIPHandlingPolicy:{clear}}},
    webRequest:{onAuthRequired:event,onCompleted:event,onErrorOccurred:event}
  });
  fetchMock.mockImplementation(async url=>{
    const path=String(url);
    if(path.endsWith('/health'))return Response.json({ok:true});
    if(path.endsWith('/api/app/v1/config'))return Response.json({ok:true,refreshAfterSeconds:900,flags:{},announcements:[]});
    if(path.endsWith('/pair/poll')){if(pollFails)throw new Error('Network unavailable');return Response.json(pollResult);}
    if(path.endsWith('/pair/start'))return Response.json({...pairing,expiresAt:Date.now()+300000});
    if(path.endsWith('/runtime-xray'))return Response.json({scope:'levik-runtime-xray',source:'live',fetchedAt:new Date().toISOString(),servers:[]});
    return Response.json(session);
  });
  vi.stubGlobal('fetch',fetchMock);
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});

describe('automatic pairing',()=>{
  it.each(['https://leviknet.org/login?next=x','https://leviknet.com/login?next=x'])('accepts trusted pairing link %s',async verificationUri=>{
    const original=fetchMock.getMockImplementation();if(!original)throw new Error('Missing fixture');
    fetchMock.mockImplementation(async(url,init)=>String(url).endsWith('/pair/start')?Response.json({...pairing,verificationUri,expiresAt:Date.now()+300000}):original(url,init));
    await start();expect((await message('login',{consent:true})).ok).toBe(true);expect(chrome.tabs.create).toHaveBeenCalledWith({url:verificationUri});
  });
  it('does not replay a failed sign-in POST on another origin',async()=>{
    const original=fetchMock.getMockImplementation();if(!original)throw new Error('Missing fixture');
    fetchMock.mockImplementation(async(url,init)=>{if(String(url).endsWith('/pair/start'))throw new Error('ambiguous network failure');return original(url,init);});
    await start();expect((await message('login',{consent:true})).error).toBe('serviceError');
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  });
  it.each(['get','refresh'])('completes an approved request on %s without exposing secrets',async type=>{
    stored.pairing=pairing;pollResult=session;await start();
    const reply=await message(type);
    expect(reply.ok).toBe(true);expect(reply.state?.session?.plan).toBe('trial');expect(reply.state?.pairing).toBeNull();
    expect(stored.session?.token).toBe(session.token);expect(stored.trialUsed).toBe(true);
    expect(JSON.stringify(reply)).not.toContain(session.token);expect(JSON.stringify(reply)).not.toContain(pairing.pollToken);
    await vi.advanceTimersByTimeAsync(10000);expect(polls()).toHaveLength(1);
  });
  it('polls while the popup is closed and stops after approval',async()=>{
    await start();await message('login',{consent:true});
    await vi.advanceTimersByTimeAsync(2500);expect(polls()).toHaveLength(1);expect(stored.session).toBeNull();
    pollResult=session;await vi.advanceTimersByTimeAsync(2500);
    expect(stored.session?.label).toBe('Test user');expect(stored.pairing).toBeNull();
    await vi.advanceTimersByTimeAsync(10000);expect(polls()).toHaveLength(2);
    expect((await message('pair-poll')).ok).toBe(true);
  });
  it('resumes stored pairing after worker initialization and recovers from network errors',async()=>{
    stored.pairing=pairing;pollFails=true;await start();
    await vi.advanceTimersByTimeAsync(2500);expect(polls()).toHaveLength(1);expect(stored.pairing).toBeTruthy();
    pollFails=false;pollResult=session;await vi.advanceTimersByTimeAsync(2500);
    expect(stored.session).not.toBeNull();expect(stored.pairing).toBeNull();
  });
  it('keeps pending or failed automatic checks quiet and preserves the manual pending response',async()=>{
    stored.pairing=pairing;await start();expect((await message('get')).ok).toBe(true);
    expect((await message('pair-poll')).error).toBe('approvalPending');
    pollFails=true;expect((await message('refresh')).ok).toBe(true);expect(stored.pairing).toBeTruthy();
  });
  it('clears a request exactly at expiry and stops requesting',async()=>{
    stored.pairing={...pairing,expiresAt:Date.now()+2500};await start();
    await vi.advanceTimersByTimeAsync(2500);expect(stored.pairing).toBeNull();expect(polls()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10000);expect(polls()).toHaveLength(0);
  });
  it('checks approval from the entitlement alarm',async()=>{
    stored.pairing=pairing;pollResult=session;await start();onAlarm.mock.calls[0]?.[0]();
    await vi.advanceTimersByTimeAsync(0);expect(stored.session).not.toBeNull();expect(stored.pairing).toBeNull();
  });
  it('rejects malformed approval without clearing the pending request',async()=>{
    stored.pairing=pairing;pollResult={...session,token:'short'};await start();
    expect((await message('get')).state?.session).toBeNull();expect(stored.pairing).toBeTruthy();
    pollResult=session;await vi.advanceTimersByTimeAsync(2500);expect(stored.session).not.toBeNull();
  });
  it('cancels polling on logout',async()=>{
    stored.pairing=pairing;await start();await message('logout');
    pollResult=session;await vi.advanceTimersByTimeAsync(10000);
    expect(polls()).toHaveLength(0);expect(stored.session).toBeNull();expect(stored.pairing).toBeNull();
  });
  it('does not mark the whole VPN disconnected for one request-level proxy error',async()=>{
    stored.connected=true;stored.connectedAt=Date.now();await start();
    onProxyError.mock.calls[0]?.[0]({fatal:false,error:'net::ERR_PAC_SCRIPT_FAILED'});await vi.advanceTimersByTimeAsync(0);
    expect(stored.connected).toBe(true);expect(stored.error).toBeNull();
  });
  it.each(['net::ERR_PROXY_CONNECTION_FAILED','net::ERR_PAC_SCRIPT_FAILED','net::ERR_MANDATORY_PROXY_CONFIGURATION_FAILED'])('stops on fatal %s and shows a connection warning',async error=>{
    stored.connected=true;stored.connectedAt=Date.now();await start();
    onProxyError.mock.calls[0]?.[0]({fatal:true,error});await vi.advanceTimersByTimeAsync(0);
    expect(stored.connected).toBe(false);expect(stored.error).toBe('connectionError');
  });
});

describe('connection stability',()=>{
  const nodeId='11111111-1111-4111-8111-111111111111';
  let inventoryFails=false;
  let nodeState='online';
  let gatewayTraffic={epoch:'fixture-traffic-epoch',uploadedBytes:0,downloadedBytes:0};
  async function connected(){
    stored.session={...session,plan:'trial',locationId:nodeId,locations:[{id:nodeId,country:'DE',city:'',flag:'de',region:'europe',available:true,latency:null}]};
    stored.preferences.locationId=nodeId;stored.connected=true;stored.connectedAt=Date.now();
    inventoryFails=false;nodeState='online';gatewayTraffic={epoch:'fixture-traffic-epoch',uploadedBytes:0,downloadedBytes:0};
    fetchMock.mockImplementation(async url=>{
      if(String(url).endsWith('/health'))return Response.json({ok:true});
      if(String(url).endsWith('/runtime-xray')){
        if(inventoryFails)throw new Error('temporary network error');
        return Response.json({scope:'levik-runtime-xray',source:'live',fetchedAt:new Date().toISOString(),servers:[{id:nodeId,countryCode:'DE',state:nodeState}]});
      }
      if(String(url).endsWith('/stats'))return Response.json(gatewayTraffic);
      return Response.json(stored.session);
    });
    await start();await message('refresh');proxyClear.mockClear();
  }
  it('retains a live snapshot after worker restart during an inventory outage',async()=>{
    const location={id:nodeId,country:'DE',city:'',flag:'de',region:'europe' as const,available:true,latency:null,online:true};
    stored.locations=[location];stored.connected=true;stored.connectedAt=Date.now();stored.preferences.locationId=nodeId;
    fetchMock.mockRejectedValue(new Error('temporary network error'));
    await start();await message('refresh');
    expect(stored.connected).toBe(true);expect(stored.locations).toEqual([location]);expect(stored.error).toBe('locationsUnavailable');
    expect(proxyClear).not.toHaveBeenCalled();
  });
  it('still discards legacy fixed catalogs on worker initialization',async()=>{
    stored.locations=[{id:nodeId,country:'DE',city:'',flag:'de',region:'europe',available:true,latency:null}];
    await start();expect((await message('get')).state?.locations).toEqual([]);
  });
  it('preserves the VPN after repeated fatal destination tunnel failures',async()=>{
    await connected();const since=stored.connectedAt;
    for(let i=0;i<3;i++)onProxyError.mock.calls[0]?.[0]({fatal:true,error:'net::ERR_TUNNEL_CONNECTION_FAILED'});
    await vi.advanceTimersByTimeAsync(0);
    expect((await message('get')).state?.connected).toBe(true);expect(stored.connectedAt).toBe(since);
    expect(stored.error).toBeNull();expect(proxyClear).not.toHaveBeenCalled();
  });
  it('reports traffic since the current connection baseline',async()=>{
    await connected();gatewayTraffic={...gatewayTraffic,uploadedBytes:1536,downloadedBytes:4096};
    const reply=await message('stats');expect(reply.state?.traffic).toEqual({uploadedBytes:1536,downloadedBytes:4096});
    expect(reply.state).not.toHaveProperty('trafficBaseline');expect(stored.trafficBaseline?.epoch).toBe(gatewayTraffic.epoch);
    gatewayTraffic={epoch:'restarted-traffic-epoch',uploadedBytes:20,downloadedBytes:40};
    expect((await message('stats')).state?.traffic).toEqual({uploadedBytes:0,downloadedBytes:0});expect(stored.trafficBaseline?.epoch).toBe(gatewayTraffic.epoch);
  });
  it.each(['refresh','alarm'])('retains connection and locations on failed %s and recovers on retry',async trigger=>{
    await connected();const locations=structuredClone(stored.locations),since=stored.connectedAt;
    inventoryFails=true;
    if(trigger==='refresh')await message('refresh');
    else {onAlarm.mock.calls[0]?.[0]();await vi.advanceTimersByTimeAsync(0);}
    expect(stored.connected).toBe(true);expect(stored.connectedAt).toBe(since);expect(stored.locations).toEqual(locations);
    expect(stored.preferences.locationId).toBe(nodeId);expect(stored.error).toBe('locationsUnavailable');expect(proxyClear).not.toHaveBeenCalled();
    inventoryFails=false;await message('refresh');expect(stored.error).toBeNull();expect(stored.connected).toBe(true);
  });
  it('retains the latest locations on a failed refresh while disconnected',async()=>{
    await connected();await message('toggle');const locations=structuredClone(stored.locations);
    inventoryFails=true;await message('refresh');expect(stored.locations).toEqual(locations);expect(stored.connected).toBe(false);
  });
  it('still disconnects when fresh inventory confirms the selected node is offline',async()=>{
    await connected();nodeState='offline';await message('refresh');
    expect(stored.connected).toBe(false);expect(stored.error).toBe('locationRemoved');expect(proxyClear).toHaveBeenCalledTimes(1);
  });
  it('still releases expired sessions during an inventory outage',async()=>{
    await connected();if(!stored.session)throw new Error('Missing session');
    await vi.advanceTimersByTimeAsync(72*3600000);inventoryFails=true;await message('refresh');
    expect(stored.connected).toBe(false);expect(proxyClear).toHaveBeenCalled();
  });
});
describe('announcements',()=>{
  const announcement={id:'5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f',level:'info',title:'Новая версия',body:'Обновите приложение.',linkUrl:null,notify:false,startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()};
  it('loads them anonymously and hides one the user closed',async()=>{
    const original=fetchMock.getMockImplementation();if(!original)throw new Error('Missing fixture');
    fetchMock.mockImplementation(async(url,init)=>String(url).endsWith('/api/app/v1/config')?Response.json({ok:true,refreshAfterSeconds:900,announcements:[announcement]}):original(url,init));
    await start();await message('get');await vi.advanceTimersByTimeAsync(0);
    const config=fetchMock.mock.calls.find(([url])=>String(url).endsWith('/api/app/v1/config'));
    expect(config?.[1]?.headers).toEqual({Accept:'application/json','X-Levik-Client':'extension/1.0.7'});
    expect((await message('get')).state?.announcements?.map(item=>item.id)).toEqual([announcement.id]);
    expect((await message('dismiss-announcement',{id:announcement.id})).state?.announcements).toEqual([]);
    expect(fetchMock.mock.calls.filter(([url])=>String(url).endsWith('/api/app/v1/config'))).toHaveLength(1);
  });
});
