import {defaults,emptyTraffic,makePac,normalizeDomain,parseAccountRules,publicState,remaining,validateEndpoint,type State,type Session,type Preferences,type TrafficTotal} from './model';
import {ApiEndpoints,fetchInventory} from './apiEndpoints';
import {loadEndpoints,refreshEndpointsIfDue,websiteOrigins} from './serviceEndpoints';
import {liveLocations,reconcileLocations} from './locations';
import {dismiss,fetchRemoteConfig,isConfigDue,visibleAnnouncements,type RemoteConfig} from './remoteConfig';
const endpoints = new ApiEndpoints();
let state: State = {locations:[],preferences:{...defaults},session:null,connected:false,connectedAt:null,traffic:emptyTraffic(),trafficBaseline:null,error:null,trialUsed:false};
let queue: Promise<unknown> = Promise.resolve();
let pairingTimer:ReturnType<typeof setTimeout>|undefined;
const attempts = new Map<string,number>();
let remoteConfig:RemoteConfig|null=null,remoteConfigFailedAt:number|null=null,dismissedAnnouncements:string[]=[],remoteConfigLoading=false;
const validBytes=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
function serial<T>(fn:()=>Promise<T>):Promise<T> {const next=queue.then(fn);queue=next.catch(()=>{});return next;}
const ready=(async()=>{
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  // Signed hosts from the last run first, so a blocked domain is not even tried.
  await loadEndpoints();
  const stored=await chrome.storage.local.get(['state','remoteConfig','remoteConfigFailedAt','dismissedAnnouncements']);
  if(stored.state) state=stored.state as State; // Only the trusted worker writes this versioned local state.
  const config=stored.remoteConfig as RemoteConfig|undefined;
  if(config&&typeof config.fetchedAt==='number'&&typeof config.refreshAfterMs==='number'&&Array.isArray(config.announcements))remoteConfig=config;
  if(typeof stored.remoteConfigFailedAt==='number')remoteConfigFailedAt=stored.remoteConfigFailedAt;
  if(Array.isArray(stored.dismissedAnnouncements))dismissedAnnouncements=stored.dismissedAnnouncements.filter((id):id is string=>typeof id==='string');
  else state.preferences.language=chrome.i18n.getUILanguage().startsWith('ru')?'ru':'en';
  if(!validBytes(state.traffic?.uploadedBytes)||!validBytes(state.traffic?.downloadedBytes))state.traffic=emptyTraffic();
  if(!state.trafficBaseline||typeof state.trafficBaseline.epoch!=='string'||!validBytes(state.trafficBaseline.uploadedBytes)||!validBytes(state.trafficBaseline.downloadedBytes))state.trafficBaseline=null;
  // Keep the last live snapshot across worker suspension, discarding legacy fixed catalogs.
  state.locations=state.locations.filter(location=>typeof location.online==='boolean');
  await chrome.alarms.create('entitlement',{periodInMinutes:1});
  schedulePairingPoll();
})();
function schedulePairingPoll(){
  clearTimeout(pairingTimer);pairingTimer=undefined;
  if(!state.pairing)return;
  // Serialize each attempt and schedule only after it finishes, avoiding a queue of slow requests.
  pairingTimer=setTimeout(()=>{void serial(async()=>{await ready;await pollPairingAutomatically();}).catch(()=>{});},Math.max(0,Math.min(2500,state.pairing.expiresAt-Date.now())));
}
async function pollPairingAutomatically(){try{await pollPairing();}catch{/* A temporary failure is retried while the request remains valid. */}finally{schedulePairingPoll();}}
async function pollPairing(){
  if(!state.pairing)return;
  if(state.pairing.expiresAt<=Date.now()){state.pairing=null;await persist();return;}
  const result=object(await request('/pair/poll',{requestId:state.pairing.requestId,pollToken:state.pairing.pollToken}));
  if(result.pending===true)return;
  const session=parseSession(result);
  await disconnect();state.session=session;state.pairing=null;
  state.trialUsed ||= session.plan==='trial';state.preferences.locationId=session.locations.find(l=>l.available)?.id??'';
  await persist();await refreshLocations();
}
/** Outside the serial queue: a slow config request must never delay connecting. */
async function refreshRemoteConfig(){
  if(remoteConfigLoading||!isConfigDue(remoteConfig,remoteConfigFailedAt))return;
  remoteConfigLoading=true;
  try{
    remoteConfig=await fetchRemoteConfig(await endpoints.origin(),chrome.runtime.getManifest().version);remoteConfigFailedAt=null;
    await chrome.storage.local.set({remoteConfig});await chrome.storage.local.remove('remoteConfigFailedAt');
  }catch{remoteConfigFailedAt=Date.now();await chrome.storage.local.set({remoteConfigFailedAt});}
  finally{remoteConfigLoading=false;}
}
async function persist(){await chrome.storage.local.set({state});await chrome.action.setBadgeText({text:state.connected?'ON':''});await chrome.action.setBadgeBackgroundColor({color:'#2182ff'});}
function setting(operation:(callback:()=>void)=>void):Promise<void>{return new Promise((resolve,reject)=>operation(()=>chrome.runtime.lastError?reject(new Error('proxyConflict')):resolve()));}
function proxyState():Promise<chrome.types.ChromeSettingGetResult<chrome.proxy.ProxyConfig>> {return new Promise(resolve=>chrome.proxy.settings.get({incognito:false},resolve));}
async function disconnect(){
  await setting(cb=>chrome.proxy.settings.clear({scope:'regular'},cb));
  await setting(cb=>chrome.privacy.network.webRTCIPHandlingPolicy.clear({scope:'regular'},cb));
  state.connected=false;state.connectedAt=null;state.traffic=emptyTraffic();state.trafficBaseline=null;state.error=null;attempts.clear();await persist();
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('serviceError');return value as Record<string,unknown>;}
function parseSession(value:unknown):Session {
  const v=object(value), ep=object(v.endpoint);
  if(typeof v.token!=='string'||v.token.length<32||typeof v.label!=='string'||v.label.length>120||(v.plan!=='trial'&&v.plan!=='pro')||typeof v.expiresAt!=='number'||!Number.isFinite(v.expiresAt)||!Array.isArray(v.locations)||v.locations.length>500||typeof v.locationId!=='string'||typeof ep.host!=='string'||typeof ep.port!=='number'||typeof ep.username!=='string'||typeof ep.password!=='string')throw new Error('serviceError');
  const endpoint={host:ep.host,port:ep.port,username:ep.username,password:ep.password};validateEndpoint(endpoint);
  const locations=v.locations.map((item):Session['locations'][number]=>{const l=object(item);if(typeof l.id!=='string'||typeof l.country!=='string'||typeof l.city!=='string'||typeof l.flag!=='string'||!['europe','americas','asia','other'].includes(String(l.region))||typeof l.available!=='boolean'||!(l.latency===null||typeof l.latency==='number'&&Number.isFinite(l.latency)&&l.latency>=0))throw new Error('serviceError');if(l.region!=='europe'&&l.region!=='americas'&&l.region!=='asia'&&l.region!=='other')throw new Error('serviceError');return {id:l.id,country:l.country,city:l.city,flag:l.flag,region:l.region,available:l.available,latency:l.latency};});
  return {token:v.token,label:v.label,plan:v.plan,expiresAt:v.expiresAt,endpoint,locationId:v.locationId,locations,...(v.rules===undefined?{}:{rules:parseAccountRules(v.rules)})};
}
async function request(path:string,body?:unknown,errors:Readonly<Record<number,string>>={}):Promise<unknown>{
  let response:Response;
  try {const api=await endpoints.resolve();response=await fetch(`${api}${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(state.session?{Authorization:`Bearer ${state.session.token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});}catch{endpoints.invalidate();throw new Error('serviceError');}
  if(!response.ok)throw new Error(errors[response.status]??(response.status===401?'invalidCode':response.status===403?'needsAccount':response.status===409?'trialUnavailable':'serviceError'));
  return response.json();
}
function parseTraffic(value:unknown):TrafficTotal {
  const v=object(value);
  if(typeof v.epoch!=='string'||v.epoch.length<16||v.epoch.length>128||!validBytes(v.uploadedBytes)||!validBytes(v.downloadedBytes))throw new Error('serviceError');
  return {epoch:v.epoch,uploadedBytes:v.uploadedBytes,downloadedBytes:v.downloadedBytes};
}
async function trafficTotal(){return parseTraffic(await request('/stats'));}
async function refreshTraffic(){
  if(!state.connected||!state.session)return;
  try{
    const total=await trafficTotal(),baseline=state.trafficBaseline;
    if(!baseline||baseline.epoch!==total.epoch){state.trafficBaseline=total;state.traffic=emptyTraffic();await persist();return;}
    state.traffic={uploadedBytes:Math.max(0,total.uploadedBytes-baseline.uploadedBytes),downloadedBytes:Math.max(0,total.downloadedBytes-baseline.downloadedBytes)};
  }catch{/* Traffic telemetry must never interrupt an otherwise healthy connection. */}
}
async function refreshSession(){
  if(!state.session)return;
  if(!remaining(state.session.expiresAt)){await disconnect();return;}
  try{
    const before=JSON.stringify(state.session.rules??null);
    state.session=parseSession(await request('/session'));
    // A rule set in the cabinet or another app reaches the open browser within a minute.
    if(state.connected&&JSON.stringify(state.session.rules??null)!==before)await applyPac(state.session);
  }
  catch(error){if(error instanceof Error&&error.message==='invalidCode'){await disconnect();state.session=null;}}
}
async function refreshLocations(){
  try{
    const next=reconcileLocations(liveLocations(await fetchInventory()),state.session?.locations??[]);
    const selected=next.find(l=>l.id===state.preferences.locationId);
    if(state.connected&&(!selected||!selected.online)){await disconnect();state.error='locationRemoved';}
    state.locations=next;
    if(!selected)state.preferences.locationId=next.find(l=>l.available)?.id??next[0]?.id??'';
    if(state.error==='locationsUnavailable')state.error=null;
    await persist();
  }catch{
    // A failed inventory request is not evidence that the active node disappeared.
    // Keep the last successful snapshot and retry on the next refresh/alarm.
    state.error='locationsUnavailable';await persist();
  }
}
async function connect(){
  if(!state.session||!remaining(state.session.expiresAt))throw new Error('needsAccount');
  const startsConnection=!state.connected;let baseline:TrafficTotal|null=state.trafficBaseline;
  if(startsConnection){try{baseline=await trafficTotal();}catch{baseline=null;}}
  const status=await proxyState();if(!['controllable_by_this_extension','controlled_by_this_extension'].includes(status.levelOfControl))throw new Error('proxyConflict');
  await refreshLocations();
  if(!state.locations.some(l=>l.id===state.preferences.locationId&&l.available))throw new Error('chooseAvailable');
  state.session=parseSession(await request(`/session?location=${encodeURIComponent(state.preferences.locationId)}`));
  if(state.session.locationId!==state.preferences.locationId)throw new Error('chooseAvailable');
  if(!remaining(state.session.expiresAt))throw new Error('needsAccount');
  if(!state.session.locations.some(l=>l.id===state.preferences.locationId&&l.available))throw new Error('chooseAvailable');
  await applyPac(state.session);
  try {
    if(state.preferences.webRtc)await setting(cb=>chrome.privacy.network.webRTCIPHandlingPolicy.set({value:'disable_non_proxied_udp',scope:'regular'},cb));
    else await setting(cb=>chrome.privacy.network.webRTCIPHandlingPolicy.clear({scope:'regular'},cb));
    if(state.preferences.webRtc){const privacy=await new Promise<chrome.types.ChromeSettingGetResult<string>>(resolve=>chrome.privacy.network.webRTCIPHandlingPolicy.get({},resolve));if(privacy.value!=='disable_non_proxied_udp')throw new Error('proxyConflict');}
    const check=await proxyState();if(check.levelOfControl!=='controlled_by_this_extension')throw new Error('proxyConflict');
    // This destination is always routed through the configured proxy, including smart mode.
    // An opaque response is sufficient: a TLS/proxy failure rejects the fetch.
    await fetch('https://example.com/',{mode:'no-cors',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});
    state.connected=true;if(startsConnection){state.connectedAt=Date.now();state.traffic=emptyTraffic();state.trafficBaseline=baseline;}state.error=null;await persist();
  }catch(error){await disconnect();throw error;}
}
async function applyPac(session:Session){
  const config:chrome.proxy.ProxyConfig={mode:'pac_script',pacScript:{data:makePac(state.preferences,session.endpoint,session.rules),mandatory:true}};
  await setting(cb=>chrome.proxy.settings.set({value:config,scope:'regular'},cb));
}
/** "This site: through the VPN / directly", saved to the Levik account through the gateway. */
async function rule(value:Record<string,unknown>){
  const session=state.session;
  if(!session?.rules)throw new Error('needsAccount');
  if(typeof value.domain!=='string')throw new Error('invalidDomain');
  const domain=normalizeDomain(value.domain);
  const body=value.op==='remove'?{op:'remove_domain',domain}:value.action==='direct'||value.action==='proxy'?{op:'set_domain',domain,action:value.action}:null;
  if(!body)throw new Error('unknownError');
  const result=object(await request('/rules',body,{400:'invalidDomain',403:'needsAccount',409:'ruleLimit',429:'tooManyChanges'}));
  session.rules=parseAccountRules(result.rules);
  if(state.connected)await applyPac(session);
  await persist();
}
async function preferences(value:unknown){
  const v=object(value), next:Preferences={...state.preferences};
  for(const [key,item] of Object.entries(v)){
    switch(key){
      case 'language':if(item!=='en'&&item!=='ru')throw new Error('unknownError');next.language=item;break;
      case 'mode':if(item!=='full'&&item!=='smart')throw new Error('unknownError');next.mode=item;break;
      case 'ruleMode':if(item!=='include'&&item!=='exclude')throw new Error('unknownError');next.ruleMode=item;break;
      case 'locationId':if(typeof item!=='string'||!state.locations.some(l=>l.id===item&&l.available))throw new Error('chooseAvailable');next.locationId=item;break;
      case 'domains':if(!Array.isArray(item)||item.length>200||item.some(d=>typeof d!=='string'))throw new Error('ruleLimit');next.domains=[...new Set(item.map(d=>normalizeDomain(String(d))))];break;
      case 'autoConnect':case 'webRtc':if(typeof item!=='boolean')throw new Error('unknownError');next[key]=item;break;
      default:throw new Error('unknownError');
    }
  }
  const previous=state.preferences;state.preferences=next;
  try {if(state.connected)await connect();await persist();}catch(error){state.preferences=previous;await disconnect();throw error;}
}
async function handle(message:unknown){
  await ready;const m=object(message);
  switch(m.type){
    case 'get': await pollPairingAutomatically();if(state.session&&!remaining(state.session.expiresAt)&&state.connected)await disconnect();if(state.connected&&(await proxyState()).levelOfControl!=='controlled_by_this_extension'){state.connected=false;state.connectedAt=null;state.traffic=emptyTraffic();state.trafficBaseline=null;state.error='proxyConflict';await persist();}break;
    case 'refresh':await pollPairingAutomatically();await refreshSession();await refreshLocations();await refreshTraffic();break;
    case 'stats':await refreshTraffic();break;
    case 'toggle':if(state.connected||state.error==='connectionError')await disconnect();else await connect();break;
    case 'preferences':await preferences(m.value);break;
    case 'rule':await rule(m);break;
    case 'trial':case 'login':{
      if(m.consent!==true)throw new Error('consentRequired');
      const pairing=object(await request('/pair/start',{intent:m.type,consent:true,language:state.preferences.language}));
      if(typeof pairing.requestId!=='string'||typeof pairing.pollToken!=='string'||typeof pairing.expiresAt!=='number'||!Number.isFinite(pairing.expiresAt)||pairing.expiresAt<=Date.now()||typeof pairing.verificationUri!=='string')throw new Error('serviceError');
      const uri=new URL(pairing.verificationUri);if(!websiteOrigins().has(uri.origin)||uri.username||uri.password||uri.pathname!=='/login')throw new Error('serviceError');
      state.pairing={requestId:pairing.requestId,pollToken:pairing.pollToken,expiresAt:pairing.expiresAt,verificationUri:pairing.verificationUri};
      await persist();schedulePairingPoll();await chrome.tabs.create({url:pairing.verificationUri});break;
    }
    case 'pair-poll':{
      // A queued manual check can arrive after the timer has already signed in.
      if(!state.pairing&&state.session)break;
      try{
        if(!state.pairing||state.pairing.expiresAt<=Date.now()){state.pairing=null;await persist();throw new Error('invalidCode');}
        await pollPairing();if(state.pairing)throw new Error('approvalPending');
      }finally{schedulePairingPoll();}
      break;
    }
    case 'dismiss-announcement':if(typeof m.id!=='string')throw new Error('unknownError');dismissedAnnouncements=dismiss(dismissedAnnouncements,m.id);await chrome.storage.local.set({dismissedAnnouncements});break;
    case 'logout':try{await request('/logout',{});}finally{await disconnect();state.session=null;state.pairing=null;schedulePairingPoll();await persist();}break;
    default:throw new Error('unknownError');
  }
  if(m.type==='get'||m.type==='refresh')void refreshRemoteConfig().catch(()=>{});
  return {...publicState(state),announcements:visibleAnnouncements(remoteConfig,dismissedAnnouncements)};
}
chrome.runtime.onMessage.addListener((message:unknown,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL(''))||sender.tab?.url&&!sender.tab.url.startsWith(chrome.runtime.getURL('')))return false;
  void serial(()=>handle(message)).then(value=>respond({ok:true,state:value}),error=>respond({ok:false,error:error instanceof Error?error.message:'unknownError'}));return true;
});
chrome.webRequest.onAuthRequired.addListener((details,callback)=>{
  if(!callback)return undefined;
  void ready.then(()=>{
    const session=state.session;
    if(!details.isProxy||!session||!remaining(session.expiresAt)||details.challenger.host!==session.endpoint.host||details.challenger.port!==session.endpoint.port){callback({});return;}
    const count=attempts.get(details.requestId)??0;attempts.set(details.requestId,count+1);
    callback(count>=1?{cancel:true}:{authCredentials:{username:session.endpoint.username,password:session.endpoint.password}});
  }).catch(()=>callback({cancel:true}));
  return undefined;
},{urls:['<all_urls>']},['asyncBlocking']);
chrome.webRequest.onCompleted.addListener(d=>attempts.delete(d.requestId),{urls:['<all_urls>']});
chrome.webRequest.onErrorOccurred.addListener(d=>attempts.delete(d.requestId),{urls:['<all_urls>']});
// Chrome marks a rejected destination CONNECT as fatal for that request,
// even while the proxy remains healthy. Keep the VPN configured in that case;
// other fatal proxy/configuration errors still surface a connection warning.
chrome.proxy.onProxyError.addListener(details=>{if(details.fatal&&details.error!=='net::ERR_TUNNEL_CONNECTION_FAILED')void serial(async()=>{await ready;if(state.connected){await disconnect();state.error='connectionError';await persist();}});});
chrome.proxy.settings.onChange.addListener(details=>{if(details.levelOfControl!=='controlled_by_this_extension')void serial(async()=>{await ready;if(state.connected){state.connected=false;state.connectedAt=null;state.traffic=emptyTraffic();state.trafficBaseline=null;state.error='proxyConflict';await persist();}});});
chrome.alarms.onAlarm.addListener(()=>{void ready.then(()=>refreshEndpointsIfDue()).then(()=>refreshRemoteConfig()).catch(()=>{});void serial(async()=>{
  await ready;
  // The existing alarm also resumes polling if Chrome suspended the service worker.
  await pollPairingAutomatically();
  await refreshSession();
  await refreshLocations();
  await refreshTraffic();
}).catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{void serial(async()=>{await ready;if(state.preferences.autoConnect){try{await connect();}catch{await disconnect();}}else await disconnect();});});
