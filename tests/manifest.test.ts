import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {BUILT_IN_ENDPOINTS} from '../src/serviceEndpoints';
const manifest=JSON.parse(readFileSync(new URL('../public/manifest.json',import.meta.url),'utf8')) as {content_security_policy:{extension_pages:string}};
const allowed=new Set(/connect-src ([^;]*)/.exec(manifest.content_security_policy.extension_pages)?.[1]?.split(' ')??[]);
describe('extension CSP',()=>{
  // The extension_pages policy also covers the service worker: a host missing here fails every fetch to it.
  it('allows every built-in service and config host',()=>{
    const origins=[...BUILT_IN_ENDPOINTS.apiOrigins,BUILT_IN_ENDPOINTS.webOrigin,...BUILT_IN_ENDPOINTS.subscriptionOrigins,...BUILT_IN_ENDPOINTS.configUrls.map(url=>new URL(url).origin),'https://sub.leviknet.com:2095'];
    expect(origins.filter(origin=>!allowed.has(origin))).toEqual([]);
  });
  it('never allows plain HTTP or a wildcard',()=>{
    expect([...allowed].filter(source=>!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(source))).toEqual([]);
  });
});
