// Compare the deployed site against this checkout, and fail if the website is behind the repo.
//
//   node scripts/deploy-drift.mjs                          # checks https://nuthatch-indexer.com
//   node scripts/deploy-drift.mjs --site http://localhost:4321
//
// Written after 2026-08-20, when PR #39 corrected the config reference to name all seven supported
// chains, merged to main, and then nothing happened. An hour later the most-linked reference page
// on the site still told a stranger nuthatch supported three. `nuthatch-frontend` has no deploy
// automation and the Vercel project is not git-integrated, so every publish is a human running
// `vercel --prod`. Merging is not publishing, and until this script existed nothing reported the
// difference. Every other drift the docs sweep found was visible from inside the repo. This one was
// only ever visible from outside it, which is why the check has to leave the building.
//
// Three checks, in descending order of how much they prove:
//
//   1. FINGERPRINT - `/build-info.json` carries a content hash of `src/` at build time. If it does
//      not equal this checkout's, the deployed site was built from different source, and that is
//      exact: it catches drift anywhere, including inside a code fence, which is where the fault
//      that prompted this lived.
//   2. ROUTES - every docs page returns 200, catching a page that merged but never published.
//   3. CLAIMS - enumerated options (`chain = "mainnet"  # mainnet | arbitrum-one | ...`) appear on
//      their deployed page verbatim. Check 1 subsumes this, but check 1 goes quiet whenever the
//      deployed build predates the stamp, and this one keeps working regardless. It also names the
//      drifted sentence rather than a hash, which is what a person actually needs to see.
//
// Check 3 relies on the highlighter emitting a comment as a single token, so the text survives
// contiguously through tag-stripping. That is true of shiki today and is asserted against the live
// page rather than assumed; if it ever changes, this check goes loudly false-positive rather than
// silently inert, which is the right way round.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { sourceFingerprint } from './stamp-build.mjs';

const root = new URL('..', import.meta.url).pathname;
const docsRoot = join(root, 'src/content/docs');

const siteFlag = process.argv.indexOf('--site');
const SITE = (siteFlag > -1 ? process.argv[siteFlag + 1] : 'https://nuthatch-indexer.com').replace(/\/$/, '');

const problems = [];
const notes = [];

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  }));
  return nested.flat();
}

async function get(path) {
  const response = await fetch(`${SITE}${path}`, { redirect: 'follow' });
  return { status: response.status, body: response.ok ? await response.text() : '' };
}

// Rendered HTML to comparable text. Entities decode last-to-first so `&amp;lt;` cannot become `<`.
function textOf(html) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

// `key = value    # a | b | c` - the trailing comment, whitespace-normalised to match textOf().
function enumeratedClaims(source) {
  const claims = [];
  for (const line of source.split('\n')) {
    const match = line.match(/^\s*[A-Za-z_][\w.]*\s*=\s*\S.*?(#\s*[^#]*\|[^#]*)$/);
    if (match) claims.push(match[1].replace(/\s+/g, ' ').trim());
  }
  return claims;
}

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}

// ---- check 1: fingerprint -------------------------------------------------------------------

const expected = await sourceFingerprint();
const stamp = await get('/build-info.json');

if (stamp.status === 404) {
  problems.push(
    'the deployed site serves no /build-info.json, so it was built before this check existed.\n' +
    '    That means it predates the current main and its age cannot be established from outside.\n' +
    '    The next `vercel --prod` from a clean main fixes this permanently.',
  );
} else if (stamp.status !== 200) {
  problems.push(`GET /build-info.json returned ${stamp.status}; cannot establish what is deployed`);
} else {
  let info;
  try {
    info = JSON.parse(stamp.body);
  } catch {
    problems.push('/build-info.json is not valid JSON');
  }
  if (info) {
    notes.push(`deployed build: ${info.builtAt ?? 'unknown time'}, commit ${info.commit?.slice(0, 12) ?? 'unknown'}`);
    if (info.contentHash !== expected) {
      problems.push(
        'the deployed site was built from different source than this checkout.\n' +
        `    deployed src ${String(info.contentHash).slice(0, 16)}\n` +
        `    checkout src ${expected.slice(0, 16)}\n` +
        '    If this checkout is main and up to date, the website is behind: run `vercel --prod`.',
      );
    }
  }
}

// ---- checks 2 and 3: routes and claims ------------------------------------------------------

const files = await markdownFiles(docsRoot);
const pages = files.map((file) => ({
  file: relative(root, file),
  // `book/index.md` is served at `/docs/book/`, not `/docs/book/index` - that 404s.
  route: `/docs/${relative(docsRoot, file).split(sep).join('/').replace(/\.md$/, '').replace(/(^|\/)index$/, '$1')}`,
  source: file,
}));

await mapWithLimit(pages, 8, async (page) => {
  const { status, body } = await get(page.route);
  if (status !== 200) {
    problems.push(`${page.route} returned ${status} (the page is in the repo but not on the site)`);
    return;
  }
  const text = textOf(body);
  for (const claim of enumeratedClaims(await readFile(page.source, 'utf8'))) {
    if (!text.includes(claim)) {
      problems.push(
        `${page.route} does not carry a claim the repo makes:\n` +
        `    ${page.file} says   ${claim}\n` +
        '    and the deployed page does not contain that line.',
      );
    }
  }
});

// ---- report ---------------------------------------------------------------------------------

console.log(`checked ${SITE} against this checkout (${pages.length} docs pages)`);
for (const note of notes) console.log(`  ${note}`);
console.log();

if (problems.length === 0) {
  console.log('no drift: the deployed site matches this checkout.');
  process.exit(0);
}

console.error(`the website is out of step with the repo in ${problems.length} way(s):`);
for (const problem of problems) console.error(`  - ${problem}`);
console.error('\nPublishing is manual for this project: `vercel --prod` from a clean main.');
process.exit(1);
