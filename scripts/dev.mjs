import {context} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {watch} from 'node:fs';
import {cp} from 'node:fs/promises';
execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
const build=await context({entryPoints:['src/popup.ts','src/background.ts'],bundle:true,outdir:'dist',format:'esm',target:'chrome120'});
await build.watch();
watch('public',{recursive:true},()=>{void cp('public','dist',{recursive:true});});
console.log('Watching. Load dist/ in chrome://extensions, then reload the extension after changes.');
