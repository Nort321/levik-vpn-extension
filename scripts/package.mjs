import {mkdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const {version}=JSON.parse(await readFile('dist/manifest.json','utf8'));
await mkdir('release',{recursive:true});
execFileSync('zip',['-q','-r',`../release/levik-vpn-${version}.zip`,'.','-x','*.DS_Store'],{cwd:'dist'});
console.log(`release/levik-vpn-${version}.zip`);
