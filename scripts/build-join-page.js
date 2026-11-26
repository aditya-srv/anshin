#!/usr/bin/env node
/*
 * Builds dist/anshin-join.html: one self-contained file with the sidebar UI and the
 * standalone client inlined. Open it in any browser; no server is needed.
 * Run `npm run compile` first (this script reads the compiled template in out/).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mediaDir = path.join(root, 'media');
const { buildSidebarHtml } = require(path.join(root, 'out', 'sidebar', 'html.js'));

const template = buildSidebarHtml({
  assetUrl: (file) => `asset:${file}`,
  csp: '',
  nonce: '',
  browser: true,
});

const readAsset = (file) => fs.readFileSync(path.join(mediaDir, file), 'utf8');
// A literal "</script" inside inlined code would end the tag early.
const safeScript = (js) => js.replace(/<\/script/gi, '<\\/script');

let html = template.replace(
  /<link href="asset:([^"]+)" rel="stylesheet" \/>/g,
  (_match, file) => `<style>\n${readAsset(file)}\n</style>`
);
html = html.replace(
  /<script(?: nonce="[^"]*")? src="asset:([^"]+)"><\/script>/g,
  (_match, file) => `<script>\n${safeScript(readAsset(file))}\n</script>`
);

if (html.includes('asset:')) {
  throw new Error('build-join-page: unresolved asset reference left in the output');
}

const dest = path.join(root, 'dist', 'anshin-join.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, html);
console.log(`Wrote ${path.relative(root, dest)} (${Math.round(html.length / 1024)} KB)`);
