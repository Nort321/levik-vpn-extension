import {build} from 'esbuild';
import {cp,mkdir,readFile} from 'node:fs/promises';
import sharp from 'sharp';
await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});
await Promise.all([16,32,48,128].map(size=>sharp('public/icons/logo.png').resize(size,size).png().toFile(`dist/icons/${size}.png`)));
await build({entryPoints:['src/popup.ts','src/background.ts'],bundle:true,outdir:'dist',format:'esm',target:'chrome120',minify:true,legalComments:'none'});
const manifest=JSON.parse(await readFile('dist/manifest.json','utf8'));
console.log(`Built Levik VPN ${manifest.version} in dist/`);
