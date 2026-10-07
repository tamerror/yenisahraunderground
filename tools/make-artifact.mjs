// Builds dist-artifact/ and folds the JS + CSS into a single page body (no <html>/<head> wrapper)
// suitable for publishing as a claude.ai Artifact. Map data stays in data/*.json next to it.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-artifact';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const assets = readdirSync(join(dir, 'assets'));
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8'));
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8'));
if (js.length !== 1) throw new Error(`expected one JS chunk, got ${js.length}`);
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
const title = html.match(/<title>.*?<\/title>/)[0];
const out = `${title}
<meta name="description" content="Gerçek mahalle sokaklarında gez, simit, çay, plak topla, sokak kedilerini besle." />
<style>${css.join('\n')}</style>
${body.trim()}
<script type="module">${js[0].replace(/<\/script/gi, '<\\/script')}</script>
`;
writeFileSync(join(dir, 'game.html'), out);
console.log('wrote', join(dir, 'game.html'), (out.length / 1024).toFixed(0), 'KB');
