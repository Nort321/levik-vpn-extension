import {describe,it,expect} from 'vitest';
import vm from 'node:vm';
import {dataSize,defaults,emptyTraffic,makePac,normalizeDomain,daysLeft,remaining,duration,publicState} from '../src/model';
import {en,ru} from '../src/i18n';
const endpoint={host:'proxy.leviknet.com',port:8443,username:'user',password:'secret'};
function route(mode:'full'|'smart',ruleMode:'include'|'exclude',host:string){const context=vm.createContext({});vm.runInContext(makePac({...defaults,mode,ruleMode,domains:['listed.com']},endpoint),context);return vm.runInContext(`FindProxyForURL('https://host/',${JSON.stringify(host)})`,context);}
describe('PAC routing',()=>{
 it('routes full browsing over TLS without direct fail-open',()=>{expect(route('full','include','anything.test')).toBe('HTTPS proxy.leviknet.com:8443');});
 it('bypasses Russian domain zones in smart mode',()=>{for(const host of ['yandex.ru','maps.yandex.ru','пример.рф','site.su','service.moscow','portal.tatar'])expect(route('smart','include',new URL(`https://${host}`).hostname)).toBe('DIRECT');});
 it('routes every other domain through VPN in smart mode',()=>{expect(route('smart','include','elsewhere.org')).toContain('HTTPS');expect(route('smart','exclude','example.net')).toContain('HTTPS');});
 it('treats the custom list as additional direct exceptions',()=>{expect(route('smart','include','listed.com')).toBe('DIRECT');expect(route('smart','exclude','www.listed.com')).toBe('DIRECT');});
 it('matches domain boundaries without suffix confusion',()=>{expect(route('smart','include','notlisted.com')).toContain('HTTPS');expect(route('smart','include','listed.com.evil.org')).toContain('HTTPS');expect(route('smart','include','example.ru.evil.org')).toContain('HTTPS');});
 it('preserves old and new API access without bypassing lookalikes',()=>{for(const host of ['leviknet.com','sub.leviknet.com','leviknet.org','api.leviknet.org','sub.leviknet.org'])expect(route('full','include',host)).toBe('DIRECT');for(const host of ['sub.leviknet.com.evil.org','api.leviknet.org.evil.org'])expect(route('full','include',host)).toContain('HTTPS');});
 it('handles uppercase and trailing dots',()=>expect(route('smart','include','YANDEX.RU.')).toBe('DIRECT'));
 it.each(['full','smart'] as const)('bypasses local names and private IP literals in %s mode',mode=>{
  for(const host of ['localhost','LOCALHOST.','app.localhost','router','nas','127.0.0.1','127.255.255.255','10.0.0.1','10.255.255.255','172.16.0.1','172.31.255.255','192.168.0.1','169.254.1.1','::1','[::1]','[0:0:0:0:0:0:0:1]','[fc00::1]','[fdff::1]','[fe80::1]','[febf::1]'])expect(route(mode,'include',host),host).toBe('DIRECT');
 });
 it.each(['full','smart'] as const)('keeps public addresses and lookalike domains proxied in %s mode',mode=>{
  for(const host of ['1.1.1.1','172.15.255.255','172.32.0.0','192.169.0.1','169.255.0.1','128.0.0.1','[2606:4700:4700::1111]','[fec0::1]','localhost.example.org','10.0.0.1.example.org','192.168.999.1','example.com'])expect(route(mode,'include',host),host).toBe('HTTPS proxy.leviknet.com:8443');
 });
 it('rejects PAC injection via domain and endpoint',()=>{expect(()=>normalizeDomain('x.com";alert(1)')).toThrow();expect(()=>makePac(defaults,{...endpoint,host:'x; DIRECT'})).toThrow();});
});
describe('domain boundary',()=>{
 it.each(['https://example.com','example.com/a','localhost','*.example.com','foo..com','127.0.0.1','-a.com','a-.com','a.com?x=1'])('rejects %s',d=>expect(()=>normalizeDomain(d)).toThrow());
 it('normalizes IDN',()=>expect(normalizeDomain('ПРИМЕР.РФ')).toBe('xn--e1afmkfd.xn--p1ai'));
});
describe('entitlements',()=>{
 it('expires exactly at 72 hours',()=>{const expiry=72*3600000;expect(daysLeft(expiry,0)).toBe(3);expect(daysLeft(expiry,expiry-1)).toBe(1);expect(remaining(expiry,expiry)).toBe(0);expect(daysLeft(expiry,expiry+1)).toBe(0);expect(duration(expiry)).toBe('72:00:00');});
 it('formats traffic totals compactly in both languages',()=>{expect(dataSize(0,'ru')).toBe('0 Б');expect(dataSize(1536,'ru')).toBe('1,5 КБ');expect(dataSize(5*1024**2,'en')).toBe('5 MB');});
 it('never exposes session credentials or the traffic baseline to popup',()=>{const result=publicState({locations:[],preferences:defaults,connected:false,connectedAt:null,traffic:emptyTraffic(),trafficBaseline:{epoch:'private-traffic-epoch',uploadedBytes:100,downloadedBytes:200},error:null,trialUsed:false,session:{token:'sensitive-token',label:'User',plan:'trial',expiresAt:10,endpoint,locationId:'',locations:[]}});expect(JSON.stringify(result)).not.toContain('sensitive-token');expect(result).not.toHaveProperty('trafficBaseline');expect(result.session).not.toHaveProperty('endpoint');});
});
it('has complete RU/EN parity and matching interpolation slots',()=>{expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());for(const key of Object.keys(en) as (keyof typeof en)[]){expect(ru[key].trim()).not.toBe('');expect(ru[key].match(/\{\w+\}/g)??[]).toEqual(en[key].match(/\{\w+\}/g)??[]);}});
