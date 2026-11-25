// Builds the deployable site into ./public from the single source file index.html.
//
// index.html holds every page as a <div class="page" id="page-…"> block. This
// script writes one real HTML file per page (clean URLs such as /about/story),
// each containing only that page's block, with its own <title>, description,
// canonical URL and social tags. It also writes sitemap.xml, robots.txt, a
// search index for the site search, and a 404 page, and copies the images.
//
// Run: node scripts/build.mjs   (Vercel runs it automatically; see vercel.json)

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public');
const SITE = 'https://www.puahfertility.org';
const OG_IMAGE = SITE + '/img/founder.jpg';

// page id -> clean URL. Keep in sync with the redirects in vercel.json.
export const ROUTES = {
  'home': '/',
  'about': '/about',
  'about-story': '/about/story',
  'about-mission': '/about/mission',
  'about-team': '/about/team',
  'about-council': '/about/medical-council',
  'about-endorsements': '/about/endorsements',
  'about-testimonials': '/about/stories',
  'services': '/services',
  'svc-guidance': '/services/guidance',
  'svc-ask': '/services/ask-the-rabbi',
  'svc-lab': '/services/lab-supervision',
  'svc-shabbos': '/services/shabbos',
  'svc-financial': '/services/financial-assistance',
  'pillars': '/pillars',
  'pillar-rabbinic': '/pillars/rabbinic',
  'pillar-medical': '/pillars/medical',
  'pillar-education': '/pillars/education',
  'getinvolved': '/get-involved',
  'gi-volunteer': '/get-involved/volunteer',
  'give': '/give',
  'books': '/books',
  'resources': '/library',
  'dictionary': '/dictionary',
  'contact': '/contact',
  'topic-ivf': '/topics/ivf',
  'topic-ttc': '/topics/trying-to-conceive',
  'topic-cycles': '/topics/cycles',
  'topic-spotting': '/topics/spotting',
  'topic-male': '/topics/male-fertility',
  'topic-loss': '/topics/pregnancy-loss',
  'topic-genetics': '/topics/genetic-testing',
  'topic-preserve': '/topics/fertility-preservation',
  'style-guide': '/style-guide',
};
// Old in-page ids that now live elsewhere: id -> [page, section]
const ALIASES = { 'svc-puahline': ['svc-ask'], 'gi-ecards': ['getinvolved'], 'gi-story': ['about-testimonials', 'share-story'], 'gi-events': ['getinvolved'], 'media': ['resources'], 'home-v1': ['home'] };
const NOINDEX = new Set(['style-guide']);

// Hand-written titles/descriptions where the page's own heading isn't enough.
const META = {
  'home': {
    title: 'PUAH | Expert Fertility Guidance Rooted in Halacha',
    description: "Free, confidential fertility guidance from PUAH's rabbis, counselors and doctors: halachic answers, lab supervision and support since 1980.",
  },
};

// Page names where the eyebrow isn't a good title.
const NAMES = {
  'about': 'About PUAH: Jewish Fertility Guidance Since 1980', 'pillars': 'The Three Pillars', 'dictionary': 'Fertility Dictionary', 'style-guide': 'Web Style Guide',
  'about-endorsements': 'Rabbinic Endorsements', 'about-testimonials': 'Stories & Testimonials', 'contact': 'Contact Us',
  'give': 'Ways to Give', 'resources': 'Digital Resource Library', 'svc-shabbos': 'Shabbos Blood Draws & Injections',
  'topic-ttc': 'Trying to Conceive', 'topic-preserve': 'Egg Freezing & Fertility Preservation',
};

const decode = (t) => t
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const clip = (t, n) => (t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n - 1)).replace(/[,;:.\s]+$/, '') + '…');

// ---------------------------------------------------------------- source
let src = readFileSync(join(ROOT, 'index.html'), 'utf8');

// Links: go('x') on <a> becomes a real href so crawlers (and middle-click) work.
const hrefFor = (id, hash) => {
  let page = id, section = hash;
  if (ALIASES[id]) { page = ALIASES[id][0]; section = section || ALIASES[id][1]; }
  const path = ROUTES[page];
  if (!path) throw new Error(`No route for go('${id}')`);
  return path + (section ? '#' + section : '');
};
src = src.replace(/<a ([^>]*?)onclick="go\('([a-z0-9-]+)'\);setTimeout\(function\(\)\{scrollToId\('([a-z0-9-]+)'\)\},\d+\)"/g,
  (_, pre, id, sec) => `<a ${pre}href="${hrefFor(id, sec)}"`);
src = src.replace(/<a ([^>]*?)onclick="go\((?:'|&#39;)([a-z0-9-]+)(?:'|&#39;)\)"/g, (_, pre, id) => `<a ${pre}href="${hrefFor(id)}"`);
src = src.replace(/<a ([^>]*?)onclick="goHelp\(\)"/g, (_, pre) => `<a ${pre}href="/#help-v2"`);
const leftover = src.match(/<a [^>]*onclick="go\(/g);
if (leftover) throw new Error('Unconverted go() links: ' + leftover.length);

// Asset paths become absolute, since pages now live in sub-folders.
src = src.replace(/(src|href)="(img|images)\//g, '$1="/$2/').replace(/url\((['"]?)(img|images)\//g, 'url($1/$2/');

// ---------------------------------------------------------------- split
const pageRe = /<div class="page[^"]*" id="page-([a-z0-9-]+)">/g;
const starts = [...src.matchAll(pageRe)].map((m) => ({ id: m[1], at: m.index }));
const footerAt = src.indexOf('<!-- FOOTER -->');
if (!starts.length || footerAt < 0) throw new Error('Could not find pages/footer in index.html');
const head = src.slice(0, starts[0].at);
const tail = src.slice(footerAt);
const blocks = starts.map((s, i) => ({ id: s.id, html: src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : footerAt) }));

for (const b of blocks) if (!ROUTES[b.id]) throw new Error(`Page "${b.id}" has no route in scripts/build.mjs`);
for (const id of Object.keys(ROUTES)) if (!blocks.find((b) => b.id === id)) throw new Error(`Route "${id}" has no page in index.html`);

// ---------------------------------------------------------------- write
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'img'), join(OUT, 'img'), { recursive: true });

const routesScript = `<script>window.__ROUTES=${JSON.stringify(ROUTES)};</script>`;
const fileFor = (path) => (path === '/' ? 'index.html' : path.slice(1) + '.html');
const searchIndex = [];
const sitemap = [];

for (const b of blocks) {
  const path = ROUTES[b.id];
  const h1 = (b.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
  const lead = (b.html.match(/<p class="lead"[^>]*>([\s\S]*?)<\/p>/) || b.html.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1];
  const eyebrow = (b.html.match(/<span class="eyebrow"[^>]*>([\s\S]*?)<\/span>/) || [])[1];
  const heading = h1 ? text(h1) : b.id;
  // Title: the page's own name (last part of its eyebrow, e.g. "About · PUAH's Story") + PUAH.
  const name = NAMES[b.id] || (eyebrow ? text(eyebrow).split(/\s+·\s+/).pop() : heading);
  const title = META[b.id]?.title || (name.includes('PUAH') ? name : `${name} | PUAH`);
  const description = clip(META[b.id]?.description || (lead ? text(lead) : heading), 158);
  const url = SITE + (path === '/' ? '/' : path);

  const meta = [
    `<title>${attr(title)}</title>`,
    `<meta name="description" content="${attr(description)}">`,
    `<link rel="canonical" href="${url}">`,
    NOINDEX.has(b.id) ? '<meta name="robots" content="noindex">' : '',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="PUAH">',
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    '<link rel="icon" type="image/png" href="/img/puah-logo.png">',
    b.id === 'home' ? `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'NGO', name: 'PUAH', url: SITE + '/', logo: SITE + '/img/puah-logo.png',
      telephone: '+1-888-993-7824', foundingDate: '1980', taxID: '11-3403453',
      address: { '@type': 'PostalAddress', postOfficeBoxNumber: '297185', addressLocality: 'Brooklyn', addressRegion: 'NY', postalCode: '11229', addressCountry: 'US' },
      sameAs: ['https://www.instagram.com/puah_fertility/', 'https://www.facebook.com/puahfertility/', 'https://www.youtube.com/channel/UC3PupKMKMuC_6Pj9i2-KdGA'],
    })}</script>` : '',
  ].filter(Boolean).join('\n');

  const page = b.html.replace(/<div class="page([^"]*)" id="page-/, (_, cls) => `<div class="page${cls.includes('active') ? cls : cls + ' active'}" id="page-`);
  const html = (head.replace(/<title>[\s\S]*?<\/title>/, meta) + page + tail)
    .replace('<script>\n  /* ---- routing ----', routesScript + '\n<script>\n  /* ---- routing ----');
  if (!html.includes('window.__ROUTES')) throw new Error('Router script marker not found');

  const file = join(OUT, fileFor(path));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);

  if (!NOINDEX.has(b.id)) {
    sitemap.push(`  <url><loc>${url}</loc><changefreq>monthly</changefreq><priority>${path === '/' ? '1.0' : path.split('/').length > 2 ? '0.6' : '0.8'}</priority></url>`);
    const body = text(b.html.replace(/<p class="note"[\s\S]*?<\/p>/g, ''));
    searchIndex.push({ id: b.id, title: heading, crumb: eyebrow ? text(eyebrow) : '', text: body });
  }
}

// 404: home page shell with a short message, not indexed.
{
  const msg = `<div class="page v2 active" id="page-notfound"><div class="stub-hero"><div class="wrap"><span class="eyebrow">Page not found</span><h1>We couldn't find <em>that page</em></h1><p class="lead" style="max-width:60ch;">The page may have moved when our site was rebuilt. Try the menu or search above, or <a class="link" href="/contact">contact us</a> and we'll help you find it.</p><p style="margin-top:22px;"><a class="v2-btn" href="/">Go to the home page</a></p></div></div></div>\n`;
  const html = head.replace(/<title>[\s\S]*?<\/title>/, '<title>Page not found | PUAH</title>\n<meta name="robots" content="noindex">\n<link rel="icon" type="image/png" href="/img/puah-logo.png">') + msg + tail.replace('<script>\n  /* ---- routing ----', routesScript + '\n<script>\n  /* ---- routing ----');
  writeFileSync(join(OUT, '404.html'), html);
}

writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.join('\n')}\n</urlset>\n`);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /style-guide\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(OUT, 'search-index.json'), JSON.stringify(searchIndex));
if (existsSync(join(ROOT, 'favicon.ico'))) cpSync(join(ROOT, 'favicon.ico'), join(OUT, 'favicon.ico'));

console.log(`Built ${blocks.length} pages, sitemap with ${sitemap.length} URLs -> public/`);
