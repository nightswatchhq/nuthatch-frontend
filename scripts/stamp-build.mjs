// Stamp the built site with a fingerprint of the source it was built from.
//
// Runs after `astro build` and writes `dist/build-info.json`, which ships as a static route.
// `scripts/deploy-drift.mjs` fetches it and compares it to the checkout, which is the only way
// to answer "is what is published the same as what is merged" from outside the repo.
//
// The fingerprint is a content hash of `src/`, not a git SHA, because `vercel --prod` builds on
// Vercel's builder from an upload that does not include `.git` - a git-based stamp would read
// "unknown" for the one deploy method this project actually uses. `src/` is safe to hash because
// `generate-sitemap.mjs` writes only into `public/`, so the tree is identical on both machines.
// The commit is recorded too, best-effort, but it is a comment rather than the check.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url).pathname;

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

// Hash of (path, bytes) for every source file, in a stable order. Raw bytes, so an editor that
// changes a line ending is drift too - it would be, on the rendered page.
export async function sourceFingerprint(sourceRoot = join(root, 'src')) {
  const files = (await filesUnder(sourceRoot)).sort();
  const digest = createHash('sha256');
  for (const file of files) {
    const relpath = relative(root, file).split(sep).join('/');
    digest.update(`${relpath}\0${createHash('sha256').update(await readFile(file)).digest('hex')}\n`);
  }
  return digest.digest('hex');
}

function commit() {
  // Whichever of these exists; none of them does on a `vercel --prod` builder, hence the fallback.
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// Only when run as a script; `deploy-drift.mjs` imports sourceFingerprint from here so that the
// two sides of the comparison can never drift apart into two implementations of "the same hash".
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const info = {
    contentHash: await sourceFingerprint(),
    commit: commit(),
    builtAt: new Date().toISOString(),
  };
  await writeFile(join(root, 'dist/build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
  console.log(`Stamped dist/build-info.json (src ${info.contentHash.slice(0, 12)}, commit ${info.commit?.slice(0, 12) ?? 'unknown'}).`);
}
