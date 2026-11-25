// Local preview of ./public with the same clean-URL rules Vercel uses
// (/about/story -> about/story.html, unknown paths -> 404.html).
// Run: node scripts/build.mjs && node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = +process.argv[2] || 8765;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon' };

async function file(p) { try { return (await stat(p)).isFile() ? p : null; } catch { return null; } }

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('.html') && path !== '/404.html') { res.writeHead(308, { Location: path.replace(/(index)?\.html$/, '') || '/' }); return res.end(); }
  const hit = (await file(join(ROOT, path))) || (await file(join(ROOT, path + '.html'))) || (await file(join(ROOT, path, 'index.html')));
  const target = hit || join(ROOT, '404.html');
  res.writeHead(hit ? 200 : 404, { 'Content-Type': TYPES[extname(target)] || 'application/octet-stream' });
  res.end(await readFile(target));
}).listen(PORT, () => console.log(`Serving public/ at http://localhost:${PORT}`));
