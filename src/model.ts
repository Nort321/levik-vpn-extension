import {serviceHosts} from './serviceEndpoints';
import type {Announcement} from './remoteConfig';
export type Language = 'en' | 'ru';
export type Mode = 'full' | 'smart';
export type Region = 'europe' | 'americas' | 'asia' | 'other';
export interface Location { id: string; country: string; city: string; flag: string; region: Region; available: boolean; latency: number | null; online?: boolean }
export interface Endpoint { host: string; port: number; username: string; password: string }
/** The Levik account's own rules, docs/app-platform.md "Account rules"; each host covers its subdomains. */
export interface AccountRules { direct: string[]; proxy: string[] }
export type RuleAction = 'direct' | 'proxy';
/** `rules` is present only for a session linked to a Levik account. */
export interface Session { token: string; label: string; plan: 'trial' | 'pro'; expiresAt: number; endpoint: Endpoint; locationId: string; locations: Location[]; rules?: AccountRules }
export interface Preferences { language: Language; locationId: string; mode: Mode; ruleMode: 'include' | 'exclude'; domains: string[]; autoConnect: boolean; webRtc: boolean }
export interface Traffic { uploadedBytes: number; downloadedBytes: number }
export interface TrafficTotal extends Traffic { epoch: string }
export interface State { locations: Location[]; preferences: Preferences; session: Session | null; connected: boolean; connectedAt: number | null; traffic: Traffic; trafficBaseline: TrafficTotal | null; error: string | null; trialUsed: boolean; pairing?: {requestId:string;pollToken:string;expiresAt:number;verificationUri:string} | null }
export type PublicState = Omit<State,'session'|'pairing'|'trafficBaseline'> & {session: Omit<Session,'token' | 'endpoint'> | null; pairing?: {expiresAt:number;verificationUri:string}|null; announcements?: Announcement[]};
export const defaults: Preferences = {language:'en',locationId:'',mode:'full',ruleMode:'include',domains:[],autoConnect:false,webRtc:true};
export const emptyTraffic=():Traffic=>({uploadedBytes:0,downloadedBytes:0});
const RUSSIAN_DOMAIN_ZONES=['ru','su','xn--p1ai','xn--p1acf','moscow','xn--80adxhks','tatar'];
export function remaining(expiresAt: number, now=Date.now()) {return Math.max(0,expiresAt-now);}
export function daysLeft(expiresAt:number,now=Date.now()) {return Math.ceil(remaining(expiresAt,now)/86_400_000);}
export function duration(ms:number) {const s=Math.max(0,Math.floor(ms/1000)); return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');}
export function dataSize(bytes:number,language:Language) {
  const safe=Math.max(0,Number.isFinite(bytes)?bytes:0),units=language==='ru'?['Б','КБ','МБ','ГБ','ТБ']:['B','KB','MB','GB','TB'];
  const unit=safe?Math.min(Math.floor(Math.log(safe)/Math.log(1024)),units.length-1):0,value=safe/1024**unit;
  return `${new Intl.NumberFormat(language,{maximumFractionDigits:unit>0&&value<10?1:0}).format(value)} ${units[unit]}`;
}
export function normalizeDomain(input:string):string {
  const value=input.trim().toLowerCase().replace(/\.$/,'');
  if(!value || value.length>253 || /[\s/:@?#*\\]/.test(value))throw new Error('invalidDomain');
  const host=new URL(`https://${value}`).hostname;
  if(!host.includes('.') || !host.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) || /^\d+(\.\d+){3}$/.test(host)) throw new Error('invalidDomain');
  return host;
}
const RULE_HOST=/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const MAX_RULE_HOSTS=500;
/** Account rules as the gateway sends them; anything else is a service error. */
export function parseAccountRules(value:unknown):AccountRules {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('serviceError');
  const {direct,proxy}=value as Record<string,unknown>;
  const hosts=(items:unknown):string[]=>{if(!Array.isArray(items)||items.length>MAX_RULE_HOSTS||!items.every((item):item is string=>typeof item==='string'&&RULE_HOST.test(item)))throw new Error('serviceError');return [...items];};
  return {direct:hosts(direct),proxy:hosts(proxy)};
}
/** The account rule that decides a host: the most specific one, as in the apps. */
export function accountRuleFor(rules:AccountRules,host:string):{domain:string;action:RuleAction}|null {
  let best:{domain:string;action:RuleAction}|null=null;
  for(const action of ['direct','proxy'] as const)for(const domain of rules[action])
    if((host===domain||host.endsWith(`.${domain}`))&&(!best||domain.length>best.domain.length))best={domain,action};
  return best;
}
export function validateEndpoint(value: Endpoint):void {
  if(!/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(value.host) || !Number.isInteger(value.port) || value.port<1 || value.port>65535 || !value.username || !value.password) throw new Error('serviceError');
}
export function makePac(preferences:Preferences,endpoint:Endpoint,rules?:AccountRules):string {
  validateEndpoint(endpoint);
  const own=rules?parseAccountRules(rules):{direct:[],proxy:[]};
  const domains=preferences.domains.map(normalizeDomain);
  // Match local names and IP literals without resolving public hostnames locally.
  // No DNS lookups and no DIRECT fallback for proxied destinations.
  const localBypass=`var ip=host.replace(/^\\[|\\]$/g,"");if(ip==="::1"||ip==="0:0:0:0:0:0:0:1"||/^(?:fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/.test(ip))return "DIRECT";if(host.indexOf(":")===-1&&(host.indexOf(".")===-1||host.slice(-10)===".localhost"))return "DIRECT";if(/^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(host)){var parts=host.split(".").map(Number);if(parts.every(function(n){return n<=255;})&&(parts[0]===127||parts[0]===10||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===192&&parts[1]===168||parts[0]===169&&parts[1]===254))return "DIRECT";}`;
  return `function FindProxyForURL(url,host){host=host.toLowerCase().replace(/\\.$/,"");${localBypass}var service=${JSON.stringify([...serviceHosts(),endpoint.host])};if(service.indexOf(host)!==-1)return "DIRECT";var proxy=${JSON.stringify(`HTTPS ${endpoint.host}:${endpoint.port}`)};if(host==="example.com")return proxy;var own=${JSON.stringify(own)};var best="",action="";["direct","proxy"].forEach(function(kind){own[kind].forEach(function(d){if((host===d||host.slice(-(d.length+1))==="."+d)&&d.length>best.length){best=d;action=kind;}});});if(action)return action==="direct"?"DIRECT":proxy;var domains=${JSON.stringify(domains)};var russianZones=${JSON.stringify(RUSSIAN_DOMAIN_ZONES)};var match=function(items){return items.some(function(d){return host===d||host.slice(-(d.length+1))==="."+d;});};return ${preferences.mode==='full'?'proxy':'match(russianZones)||match(domains)?"DIRECT":proxy'};}`;
}
export function publicState(state:State):PublicState {
  const {session}=state;
  return {locations:state.locations,preferences:state.preferences,connected:state.connected,connectedAt:state.connectedAt,traffic:state.traffic,error:state.error,trialUsed:state.trialUsed,pairing:state.pairing?{expiresAt:state.pairing.expiresAt,verificationUri:state.pairing.verificationUri}:null,session:session?{label:session.label,plan:session.plan,expiresAt:session.expiresAt,locationId:session.locationId,locations:session.locations,...(session.rules?{rules:session.rules}:{})}:null};
}
