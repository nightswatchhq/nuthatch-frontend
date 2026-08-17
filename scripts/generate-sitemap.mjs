import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const site = 'https://nuthatch-indexer.com';
const routes = ['/', '/install', '/example', '/stories', '/roadmap', '/nests', '/manifesto', '/blog', '/docs'];

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  }));
  return nested.flat();
}

const docsRoot = join(root, 'src/content/docs');
for (const file of await markdownFiles(docsRoot)) {
  routes.push(`/docs/${relative(docsRoot, file).split(sep).join('/').replace(/\.md$/, '')}`);
}

const blogRoot = join(root, 'src/content/blog');
for (const file of await markdownFiles(blogRoot)) {
  const source = await readFile(file, 'utf8');
  if (!/^draft:\s*true\s*$/m.test(source)) {
    routes.push(`/blog/${relative(blogRoot, file).replace(/\.md$/, '')}`);
  }
}

const urls = [...new Set(routes)].sort((a, b) => a.localeCompare(b));
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((route) => `  <url><loc>${site}${route}</loc></url>`).join('\n')}\n</urlset>\n`;
await writeFile(join(root, 'public/sitemap.xml'), xml);
console.log(`wrote sitemap with ${urls.length} URLs`);
