import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
const result=await build({entryPoints:['scripts/review-entry.tsx'],bundle:true,write:false,format:'iife',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
const script=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const css=(await readFile('src/styles.css','utf8'))+(await readFile('src/finishing.css','utf8'));
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vocal Compass — design review (not your data)</title><style>${css}\n#preview-tools{position:relative;padding:12px 20px;background:#233e32;color:#fff;font:13px system-ui;display:flex;align-items:center;gap:10px;flex-wrap:wrap;z-index:5}#preview-tools button{min-height:40px;padding:8px 12px;border:1px solid #c6ddcf;border-radius:8px;background:transparent;color:#fff;cursor:pointer}</style></head><body><div id="preview-tools"><strong id="preview-label">DESIGN PREVIEW — temporary data</strong><button id="preview-empty">Empty state</button><button id="preview-demo">Show fabricated sample progress</button></div><div id="root"></div><script>${script}</script></body></html>`;
await writeFile(process.argv[2]??'/mnt/data/Vocal_Compass_Review.html',html);
