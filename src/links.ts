export type AccountDestination='dashboard'|'plans'|'subscriptions';

export function accountUrl(destination:AccountDestination){
  return `https://leviknet.org/dashboard${destination==='dashboard'?'':`/${destination}`}`;
}
