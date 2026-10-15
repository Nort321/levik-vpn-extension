import {describe,expect,it} from 'vitest';
import vm from 'node:vm';
import {accountRuleFor,defaults,emptyTraffic,makePac,parseAccountRules,publicState,type AccountRules,type Mode} from '../src/model';
const endpoint={host:'proxy.leviknet.com',port:8443,username:'user',password:'secret'};
const proxy='HTTPS proxy.leviknet.com:8443';
const rules:AccountRules={direct:['sberbank.ru','m.youtube.com','bank.example'],proxy:['youtube.com','kinopoisk.ru']};
function route(mode:Mode,host:string,own:AccountRules|null=rules){
  const context=vm.createContext({});
  vm.runInContext(makePac({...defaults,mode},endpoint,own??undefined),context);
  return vm.runInContext(`FindProxyForURL('https://host/',${JSON.stringify(host)})`,context) as string;
}
describe('account rules',()=>{
  it('send a site around the VPN even in full mode',()=>{
    expect(route('full','bank.example')).toBe('DIRECT');
    expect(route('full','online.bank.example')).toBe('DIRECT');
    expect(route('full','other.example')).toBe(proxy);
  });
  it('send a site through the VPN even where smart mode goes direct',()=>{
    expect(route('smart','kinopoisk.ru')).toBe(proxy);
    expect(route('smart','www.kinopoisk.ru')).toBe(proxy);
    expect(route('smart','yandex.ru')).toBe('DIRECT');
  });
  it('let the most specific rule win',()=>{
    expect(route('full','m.youtube.com')).toBe('DIRECT');
    expect(route('smart','www.youtube.com')).toBe(proxy);
    expect(accountRuleFor(rules,'video.m.youtube.com')).toEqual({domain:'m.youtube.com',action:'direct'});
    expect(accountRuleFor(rules,'youtube.com.evil.org')).toBeNull();
  });
  it('never override the connection check or the service hosts',()=>{
    expect(route('full','example.com',{direct:['example.com'],proxy:[]})).toBe(proxy);
    expect(route('full','proxy.leviknet.com',{direct:[],proxy:['proxy.leviknet.com']})).toBe('DIRECT');
  });
  it('change nothing for a session without an account',()=>{
    expect(route('smart','kinopoisk.ru',null)).toBe('DIRECT');
    expect(route('full','bank.example',null)).toBe(proxy);
  });
  it('reject anything but a list of hosts',()=>{
    expect(parseAccountRules({direct:['a.example'],proxy:[]})).toEqual({direct:['a.example'],proxy:[]});
    for(const value of [null,[],{direct:[]},{direct:['x.com";alert(1)'],proxy:[]},{direct:['*.x.com'],proxy:[]},{direct:[1],proxy:[]},{direct:Array(501).fill('a.example'),proxy:[]}])
      expect(()=>parseAccountRules(value)).toThrow('serviceError');
    expect(()=>makePac(defaults,endpoint,{direct:['bad host'],proxy:[]})).toThrow();
  });
  it('reach the popup without the session secrets',()=>{
    const session={token:'t'.repeat(40),label:'Levik',plan:'pro' as const,expiresAt:1,endpoint,locationId:'de',locations:[],rules};
    const state=publicState({locations:[],preferences:defaults,session,connected:false,connectedAt:null,traffic:emptyTraffic(),trafficBaseline:null,error:null,trialUsed:false});
    expect(state.session?.rules).toEqual(rules);
    expect(JSON.stringify(state)).not.toContain('secret');
  });
});
