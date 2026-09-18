// Renders src/pages/<locale>/<name>.html into site/ using src/layout.html.
// Every page shares one header, one footer and one set of tokens, so a change
// to the chrome happens in one place. See DESIGN_RULES.md rule 9.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'site');

const layout = readFileSync(join(SRC, 'layout.html'), 'utf8');

const partials = Object.fromEntries(
  existsSync(join(SRC, 'partials'))
    ? readdirSync(join(SRC, 'partials'))
        .filter((f) => f.endsWith('.html'))
        .map((f) => [f.replace(/\.html$/, ''), readFileSync(join(SRC, 'partials', f), 'utf8').trimEnd()])
    : []
);

function expandPartials(html, where) {
  return html.replace(/\{\{>\s*(\w+)\s*\}\}/g, (match, key) => {
    if (!(key in partials)) throw new Error(`${where}: unknown partial ${match}`);
    return partials[key];
  });
}
const strings = JSON.parse(readFileSync(join(SRC, 'strings.json'), 'utf8'));
const locales = Object.keys(strings);

const LOCALE_NAMES = { en: 'EN', ar: 'عربي', zh: '中文' };

function outputPath(locale, name) {
  const prefix = locale === 'en' ? '' : `${locale}/`;
  return name === 'index' ? `${prefix}index.html` : `${prefix}${name}/index.html`;
}

function baseFor(path) {
  const depth = path.split('/').length - 1;
  return '../'.repeat(depth);
}

function navLinks(locale, base, current) {
  return strings[locale].nav
    .map((item) => {
      const active = item.key === current ? ' aria-current="page"' : '';
      return `      <a href="${base}${item.href}"${active}>${item.label}</a>`;
    })
    .join('\n');
}

function langLinks(locale, base) {
  return locales
    .map((code) => {
      const href = code === 'en' ? base : `${base}${code}/`;
      const active = code === locale ? ' aria-current="true"' : '';
      return `        <a href="${href}" lang="${code}"${active}>${LOCALE_NAMES[code]}</a>`;
    })
    .join('\n');
}

function fill(template, values, where) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`${where}: unknown placeholder ${match}`);
    return values[key];
  });
}

function render(locale, name, source) {
  const split = source.indexOf('\n---\n');
  if (split === -1) throw new Error(`${locale}/${name}: missing front matter`);

  const meta = JSON.parse(source.slice(0, split));
  const body = source.slice(split + 5).trimEnd();
  const path = outputPath(locale, name);
  const base = baseFor(path);
  const chrome = strings[locale];

  const values = {
    lang: locale,
    dir: chrome.dir,
    title: meta.title,
    description: meta.description,
    base,
    home: base === '' ? './' : base,
    homeLabel: chrome.homeLabel,
    skip: chrome.skip,
    menu: chrome.menu,
    navLabel: chrome.navLabel,
    footerLabel: chrome.footerLabel,
    footerText: chrome.footerText,
    contact: chrome.contact,
    privacy: chrome.privacy,
    navLinks: navLinks(locale, base, meta.nav),
    langLinks: langLinks(locale, base),
    ...chrome.form,
    body: '',
  };

  const where = `${locale}/${name}`;
  values.body = fill(expandPartials(body, where), values, where);

  return { path, html: fill(layout, values, where) };
}

function clean() {
  for (const entry of readdirSync(OUT, { withFileTypes: true })) {
    if (entry.name === 'assets') continue;
    if (entry.isDirectory() || entry.name.endsWith('.html')) {
      rmSync(join(OUT, entry.name), { recursive: true, force: true });
    }
  }
}

if (existsSync(OUT)) clean();

let count = 0;
for (const locale of locales) {
  const dir = join(SRC, 'pages', locale);
  if (!existsSync(dir)) continue;

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
    const name = file.replace(/\.html$/, '');
    const { path, html } = render(locale, name, readFileSync(join(dir, file), 'utf8'));
    const target = join(OUT, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${html}\n`);
    count += 1;
  }
}

// The WordPress drop-in carries the same stylesheets, so the theme cannot drift
// from the repository. See wordpress/README.md.
const wpTemplate = join(SRC, 'wordpress', 'nutramea-design.php.tpl');

if (existsSync(wpTemplate)) {
  const css = ['tokens.css', 'site.css']
    .map((file) => readFileSync(join(OUT, 'assets', file), 'utf8').trimEnd())
    .join('\n\n');

  const php = readFileSync(wpTemplate, 'utf8')
    .replace('{{css}}', css)
    .replace('{{version}}', createHash('sha256').update(css).digest('hex').slice(0, 12));

  mkdirSync(join(ROOT, 'wordpress'), { recursive: true });
  writeFileSync(join(ROOT, 'wordpress', 'nutramea-design.php'), php);
  console.log('build: wordpress/nutramea-design.php written');
}

console.log(`build: ${count} page(s) written to site/`);
