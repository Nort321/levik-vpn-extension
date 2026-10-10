import {describe,expect,it} from 'vitest';
import {accountUrl} from '../src/links';

describe('account links',()=>{
  it('opens the account overview',()=>expect(accountUrl('dashboard')).toBe('https://leviknet.org/dashboard'));
  it('opens plans for trial upgrades',()=>expect(accountUrl('plans')).toBe('https://leviknet.org/dashboard/plans'));
  it('opens subscription management for Pro',()=>expect(accountUrl('subscriptions')).toBe('https://leviknet.org/dashboard/subscriptions'));
});
