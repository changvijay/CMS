#!/usr/bin/env node
// Builds public/manual/index.html (the web user manual) from docs/user-guide/README.md.
// Needs pandoc. Run: node scripts/build-user-manual-html.cjs
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'docs', 'user-guide');
const OUT_DIR = path.join(ROOT, 'public', 'manual');
const DOCX = 'CMS-Analytics-Studio-User-Guide.docx';

let md = fs.readFileSync(path.join(SRC_DIR, 'README.md'), 'utf8');
// The page hero and sidebar replace the title, intro and Contents table.
md = md.slice(md.indexOf('## 1.'));

let html = execFileSync('pandoc', ['-f', 'gfm', '-t', 'html5', '--wrap=none'], { input: md }).toString();

html = html.replace(/<hr \/>\n?/g, '');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = (s) => s.replace(/<[^>]+>/g, '');

// Image + "*Figure …*" caption -> <figure>
html = html.replace(/<p><img src="([^"]+)" alt="([^"]*)" \/><\/p>\s*<p><em>(Figure[^<]*)<\/em><\/p>/g,
  (_, src, alt, cap) => `<figure><button class="zoom" type="button" aria-label="Enlarge ${esc(cap)}"><img src="${src}" alt="${alt}" loading="lazy" /><span class="hint"><svg class="ph"><use href="#ph-magnifying-glass-plus"/></svg>Enlarge</span></button><figcaption>${cap}</figcaption></figure>`);
html = html.replace(/<p><img src="([^"]+)" alt="([^"]*)" \/><\/p>/g,
  (_, src, alt) => `<figure><button class="zoom" type="button" aria-label="Enlarge image"><img src="${src}" alt="${alt}" loading="lazy" /></button></figure>`);

// Label tables: first header cell is "#"
html = html.replace(/<table>(\s*<thead>\s*<tr[^>]*>\s*<th[^>]*>#<\/th>)/g, '<table class="legend">$1');
html = html.replace(/<table>/g, '<table class="plain">');
html = html.replace(/<td>([①-⑩])<\/td>/g, (_, c) => `<td><span class="num">${'①②③④⑤⑥⑦⑧⑨⑩'.indexOf(c) + 1}</span></td>`);
html = html.replace(/<table/g, '<div class="table-wrap"><table').replace(/<\/table>/g, '</table></div>');
// Inline "→ ⑥" references -> small badges
html = html.replace(/([①-⑩])/g, (c) => `<span class="num sm">${'①②③④⑤⑥⑦⑧⑨⑩'.indexOf(c) + 1}</span>`);

// Wrap each h2 section so search can hide/show it, and build the sidebar.
const toc = [];
const parts = html.split(/(?=<h2 id=)/);
const intro = parts[0].startsWith('<h2') ? '' : parts.shift();
const sections = parts.map((p) => {
  const m = p.match(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/);
  const subs = [...p.matchAll(/<h3 id="([^"]+)">([\s\S]*?)<\/h3>/g)].map((s) => ({ id: s[1], title: strip(s[2]) }));
  toc.push({ id: m[1], title: strip(m[2]), subs });
  return `<section class="doc-section" data-id="${m[1]}">${p}</section>`;
}).join('\n');

const tocHtml = toc.map((t) => `<li><a href="#${t.id}" data-target="${t.id}">${esc(t.title)}</a>${t.subs.length ? `<ul>${t.subs.map((s) => `<li><a href="#${s.id}" data-target="${s.id}">${esc(s.title)}</a></li>`).join('')}</ul>` : ''}</li>`).join('\n');

const page = fs.readFileSync(path.join(__dirname, 'user-manual-template.html'), 'utf8')
  .replace('{{TOC}}', tocHtml)
  .replace('{{INTRO}}', intro)
  .replace('{{CONTENT}}', sections)
  .replace('{{ICONS}}', fs.readFileSync(path.join(__dirname, 'phosphor-sprite.html'), 'utf8'))
  .replace(/{{DOCX}}/g, DOCX);

fs.mkdirSync(path.join(OUT_DIR, 'images'), { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), page);
for (const f of fs.readdirSync(path.join(SRC_DIR, 'images'))) fs.copyFileSync(path.join(SRC_DIR, 'images', f), path.join(OUT_DIR, 'images', f));
if (fs.existsSync(path.join(SRC_DIR, DOCX))) fs.copyFileSync(path.join(SRC_DIR, DOCX), path.join(OUT_DIR, DOCX));
console.log(`Wrote ${path.relative(ROOT, path.join(OUT_DIR, 'index.html'))} with ${toc.length} sections`);
