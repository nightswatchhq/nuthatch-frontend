// Writes src/data/releases.json from the published GitHub releases: version, date, the first sentence
// of the notes, and their URL. /install and /changelog render from it, so a release pass runs this
// instead of writing prose about the release into the install page (#104).
//
//   node scripts/sync-releases.mjs        # GITHUB_TOKEN is used if set; unauthenticated works too
import { writeFile } from 'node:fs/promises';

const repo = 'nightswatchhq/nuthatch';
const out = new URL('../src/data/releases.json', import.meta.url);
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'nuthatch-frontend' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const releases = [];
for (let page = 1; ; page++) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for page ${page}`);
  const batch = await res.json();
  releases.push(...batch);
  if (batch.length < 100) break;
}

// The first prose paragraph, skipping a leading blockquote (5.0.0's "Never published" banner),
// cut at the first full stop that ends a sentence rather than sits inside a version number.
const headline = (body) => {
  const para = (body ?? '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('>') && !p.startsWith('#'));
  if (!para) return '';
  const flat = para.replace(/\s+/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '');
  return flat.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? flat;
};

const rows = releases
  .filter((r) => !r.draft && !r.prerelease)
  .map((r) => ({
    version: r.tag_name.replace(/^v/, ''),
    date: r.published_at.slice(0, 10),
    headline: headline(r.body),
    url: r.html_url,
  }))
  .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));

if (!rows.length) throw new Error('no published releases; refusing to write an empty changelog');
for (const r of rows) if (!r.headline) console.warn(`v${r.version}: no headline found in its notes`);

// One release per line, newest first: scripts/version-check.sh probes the first "version" line.
await writeFile(out, `[\n${rows.map((r) => '  ' + JSON.stringify(r)).join(',\n')}\n]\n`);
console.log(`wrote ${rows.length} releases, latest v${rows[0].version}`);
