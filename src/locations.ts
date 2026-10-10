import type {Location, Region} from './model';
const europe=new Set('AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA'.split(' '));
const americas=new Set('AG AR BS BB BZ BO BR CA CL CO CR CU DM DO EC SV GD GT GY HT HN JM MX NI PA PY PE KN LC VC SR TT US UY VE'.split(' '));
const asia=new Set('AF AM AZ BH BD BT BN KH CN GE IN ID IR IQ IL JP JO KZ KW KG LA LB MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TM AE UZ VN YE'.split(' '));
function region(code:string):Region{return europe.has(code)?'europe':americas.has(code)?'americas':asia.has(code)?'asia':'other';}
export function liveLocations(value:unknown,now=Date.now()):Location[]{
  if(!value||typeof value!=='object'||!('servers' in value)||!Array.isArray(value.servers)||value.servers.length>500||!('scope' in value)||value.scope!=='levik-runtime-xray'||!('source' in value)||value.source!=='live'||!('fetchedAt' in value)||typeof value.fetchedAt!=='string')throw new Error('locationsUnavailable');
  const age=now-Date.parse(value.fetchedAt);if(!Number.isFinite(age)||age>120000||age< -30000)throw new Error('locationsUnavailable');
  const seen=new Set<string>();
  return value.servers.map((item:unknown)=>{
    if(!item||typeof item!=='object'||!('id' in item)||typeof item.id!=='string'||!(/^[0-9a-f-]{36}$/i.test(item.id))||seen.has(item.id)||!('countryCode' in item)||typeof item.countryCode!=='string'||!(/^[a-z]{2}$/i.test(item.countryCode))||!('state' in item)||!['online','offline','maintenance','degraded'].includes(String(item.state)))throw new Error('locationsUnavailable');
    seen.add(item.id);const code=item.countryCode.toUpperCase();
    return {id:item.id,country:code,city:'',flag:code.toLowerCase(),region:region(code),available:false,latency:null,online:item.state==='online'};
  });
}
export function reconcileLocations(live:Location[],configured:Location[]):Location[]{
  // Metadata/membership comes only from the current panel, never from cached session entries.
  return live.map(location=>{
    const gateway=configured.find(item=>item.id===location.id);
    return {...location,available:location.online===true&&gateway?.available===true,latency:gateway?.latency??null};
  });
}
