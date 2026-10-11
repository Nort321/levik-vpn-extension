import {serviceEndpoints} from './serviceEndpoints';

export type AccountDestination='dashboard'|'plans'|'subscriptions';

export function accountUrl(destination:AccountDestination){
  return `${serviceEndpoints().webOrigin}/dashboard${destination==='dashboard'?'':`/${destination}`}`;
}
