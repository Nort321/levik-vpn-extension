import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {accountUrl} from '../src/links';
import {makePac,defaults} from '../src/model';
import {
  BUILT_IN_ENDPOINTS,derToP1363,fetchEndpointsDocument,refreshEndpoints,refreshEndpointsIfDue,serviceEndpoints,
  useEndpointsDocument,verifyEndpointsDocument,websiteOrigins,loadEndpoints,
} from '../src/serviceEndpoints';

const fixture=(name:string)=>new Uint8Array(readFileSync(join(__dirname,'fixtures',name)));
const body=fixture('levik-config-v1.json');
const signature=new TextDecoder().decode(fixture('levik-config-v1.json.sig'));

function memoryStorage(){
  const data:Record<string,unknown>={};
  return {data,area:{
    get:async(keys:string[])=>Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,data[k]])),
    set:async(items:Record<string,unknown>)=>{Object.assign(data,items);},
  } as unknown as chrome.storage.StorageArea};
}

afterEach(()=>{vi.unstubAllGlobals();useEndpointsDocument(null);});

describe('signed service endpoints',()=>{
  it('accepts the published document with the key built into the extension',async()=>{
    const document=await verifyEndpointsDocument(body,signature);
    expect(document?.apiOrigins[0]).toBe('https://api.cloudnote-sync.xyz');
    expect(document?.subscriptionOrigins[0]).toBe('https://sub.cloudnote-sync.xyz');
  });

  it('rejects a document changed after signing',async()=>{
    const forged=new TextEncoder().encode(new TextDecoder().decode(body).replace('cloudnote-sync.xyz','attacker.example'));
    expect(await verifyEndpointsDocument(forged,signature)).toBeNull();
  });

  it('converts DER signatures and rejects malformed ones',()=>{
    const der=Uint8Array.from([0x30,0x08,0x02,0x02,0x00,0x81,0x02,0x02,0x01,0x02]);
    const raw=derToP1363(der);
    expect(raw?.[31]).toBe(0x81);expect(raw?.[62]).toBe(0x01);expect(raw?.[63]).toBe(0x02);
    expect(derToP1363(Uint8Array.from([0x30,0x09,0x02]))).toBeNull();
  });

  it('accepts a document signed with another key only when that key is given',async()=>{
    const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const document=new TextEncoder().encode(JSON.stringify({schema:1,sequence:4,apiOrigins:['https://api.reserve.example','http://plain.example'],webOrigin:'https://site.example'}));
    const raw=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,document));
    const der=(part:Uint8Array)=>{const trimmed=part[0]!>=0x80?Uint8Array.from([0,...part]):part;return [0x02,trimmed.length,...trimmed];};
    const sequence=[...der(raw.subarray(0,32)),...der(raw.subarray(32))];
    const encoded=btoa(String.fromCharCode(0x30,sequence.length,...sequence));
    expect(await verifyEndpointsDocument(document,encoded)).toBeNull();
    expect(await verifyEndpointsDocument(document,encoded,keys.publicKey)).toMatchObject({sequence:4,apiOrigins:['https://api.reserve.example'],subscriptionOrigins:[]});
  });

  it('applies signed hosts to links, sign-in pages and the proxy bypass',()=>{
    useEndpointsDocument({sequence:3,apiOrigins:['https://api.reserve.example'],webOrigin:'https://site.example',subscriptionOrigins:['https://sub.reserve.example'],configUrls:[]});
    expect(serviceEndpoints().apiOrigins).toEqual(['https://api.reserve.example',...BUILT_IN_ENDPOINTS.apiOrigins]);
    expect(accountUrl('plans')).toBe('https://site.example/dashboard/plans');
    expect(websiteOrigins().has('https://site.example')).toBe(true);
    const pac=makePac({...defaults,mode:'full'},{host:'proxy.example',port:443,username:'u',password:'p'});
    expect(pac).toContain('"api.reserve.example"');expect(pac).toContain('"sub.reserve.example"');expect(pac).toContain('"proxy.example"');
  });

  it('stores a newer document, verifies it on load and checks at most twice a day',async()=>{
    const fetchMock=vi.fn(async(url:string)=>new Response(url.endsWith('.sig')?signature:body));
    const {data,area}=memoryStorage();
    expect(await refreshEndpointsIfDue(area,fetchMock as typeof fetch)).toBe(true);
    expect(await refreshEndpointsIfDue(area,fetchMock as typeof fetch)).toBe(false);
    expect(await refreshEndpoints(0,area,fetchMock as typeof fetch)).toBe(false);
    useEndpointsDocument(null);
    await loadEndpoints(area);
    expect(serviceEndpoints().sequence).toBeGreaterThanOrEqual(1);
    const stored=data.serviceEndpoints as {body:string;signature:string};
    data.serviceEndpoints={...stored,body:btoa(atob(stored.body).replace('cloudnote-sync.xyz','attacker.example'))};
    useEndpointsDocument(null);
    await loadEndpoints(area);
    expect(serviceEndpoints().sequence).toBe(0);
  });

  it('skips broken mirrors and older documents',async()=>{
    const fetchMock=vi.fn(async(url:string)=>{
      if(url.startsWith('https://blocked.example'))throw new TypeError('blocked');
      return new Response(url.endsWith('.sig')?signature:body);
    });
    const urls=['https://blocked.example/a.json','https://good.example/a.json'];
    expect((await fetchEndpointsDocument(urls,1,fetchMock as typeof fetch))?.document.sequence).toBeGreaterThanOrEqual(1);
    expect(await fetchEndpointsDocument(urls,1000,fetchMock as typeof fetch)).toBeNull();
  });
});
