// Bundles the in-chat view into one self-contained HTML file: view/view.html.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const out = await build({ entryPoints: ['view/view-src.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = (await readFile('view/view.template.html', 'utf8')).replace('/*BUNDLE*/', () => js);
await writeFile('view/view.html', html);
console.log(`view/view.html: ${(html.length / 1024).toFixed(0)} KB`);
