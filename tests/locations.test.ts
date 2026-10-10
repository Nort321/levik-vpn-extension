import {expect,it} from 'vitest';
import {liveLocations,reconcileLocations} from '../src/locations';
const a={id:'11111111-1111-4111-8111-111111111111',countryCode:'DE',state:'online'};
const b={id:'22222222-2222-4222-8222-222222222222',countryCode:'JP',state:'online'};
const snapshot=(servers:unknown[])=>({scope:'levik-runtime-xray',source:'live',fetchedAt:new Date().toISOString(),servers});
it('shows added panel nodes and removes deleted nodes instead of merging a fallback catalog',()=>{
 const first=liveLocations(snapshot([a]));expect(first.map(l=>l.id)).toEqual([a.id]);
 const second=liveLocations(snapshot([b]));expect(second.map(l=>l.id)).toEqual([b.id]);
 expect(reconcileLocations(second,[{...first[0]!,available:true}]).map(l=>l.id)).toEqual([b.id]);
 expect(second[0]?.region).toBe('asia');expect(second[0]?.city).toBe('');
});
it('only enables the actual online node with a configured browser endpoint',()=>{
 const nodes=liveLocations(snapshot([a,b]));const configured=[{...nodes[0]!,available:true,latency:47}];
 expect(reconcileLocations(nodes,configured).map(l=>l.available)).toEqual([true,false]);
 expect(reconcileLocations(nodes,configured).map(l=>l.latency)).toEqual([47,null]);
 expect(reconcileLocations(liveLocations(snapshot([{...a,state:'offline'}])),configured)[0]?.available).toBe(false);
});
it('accepts an empty current panel and rejects stale, malformed, duplicate inventory',()=>{
 expect(liveLocations(snapshot([]))).toEqual([]);
 expect(()=>liveLocations({...snapshot([a]),source:'stale'})).toThrow();
 expect(()=>liveLocations({...snapshot([a]),scope:undefined})).toThrow();
 expect(()=>liveLocations({...snapshot([a]),scope:'levik-runtime-hysteria'})).toThrow();
 expect(()=>liveLocations({...snapshot([a]),fetchedAt:'2000-01-01'})).toThrow();
 expect(()=>liveLocations(snapshot([a,a]))).toThrow();
 expect(()=>liveLocations(snapshot([{...a,id:'de'}]))).toThrow();
});
