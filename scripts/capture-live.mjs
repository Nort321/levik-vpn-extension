import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'levik-live-inventory-'));
const dist=resolve('dist');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,locale:'en-US',viewport:{width:380,height:600},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
try{
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 const page=await context.newPage();await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
 await page.evaluate(()=>chrome.runtime.sendMessage({type:'preferences',value:{language:'en'}}));
 await page.locator('h1').filter({hasText:'Unprotected'}).waitFor();
 const result=await page.evaluate(()=>chrome.runtime.sendMessage({type:'refresh'}));assert.equal(result.ok,true);assert.ok(result.state.locations.length>0);assert.equal(result.state.error,null);
 const inventory=await page.evaluate(async()=>{const response=await fetch('https://sub.leviknet.com:2095/levik-status/extension/runtime-xray',{cache:'no-store',credentials:'omit'});if(!response.ok)throw new Error('Live inventory unavailable');return response.json();});
 assert.equal(inventory.scope,'levik-runtime-xray');assert.deepEqual(result.state.locations.map(node=>node.id).sort(),inventory.servers.map(node=>node.id).sort());
 await page.screenshot({path:'store/screenshots/home-en.png'});
 await page.locator('[data-action=settings]').click();await page.locator('#language').selectOption('ru');await page.locator('h1').filter({hasText:'Общие настройки'}).waitFor();
 await page.locator('[data-action=home]').first().click();await page.screenshot({path:'store/screenshots/home-ru.png'});
 await page.locator('[data-action=locations]').first().click();await page.locator('#search').waitFor();
 await page.screenshot({path:'store/screenshots/locations-ru.png'});
 assert.equal(await page.locator('.server').count(),Math.min(7,result.state.locations.length));
 console.log(`Live Chromium inventory check passed: ${result.state.locations.length} actual panel nodes, no mocked fetch.`);
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
