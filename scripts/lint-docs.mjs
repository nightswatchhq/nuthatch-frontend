import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const docsRoot = join(root, 'src/content/docs');

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  }));
  return nested.flat();
}

const files = await markdownFiles(docsRoot);
const routes = new Set(files.map((file) => relative(docsRoot, file).split(sep).join('/').replace(/\.md$/, '')));
const failures = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const label = relative(root, file);
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter || !/^title:\s*.+$/m.test(frontmatter[1]) || !/^description:\s*.+$/m.test(frontmatter[1])) {
    failures.push(`${label}: missing title or description frontmatter`);
  }

  let fenced = false;
  for (const [index, line] of source.split('\n').entries()) {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced && /^#{2,6}\s/.test(line)) {
      failures.push(`${label}:${index + 1}: a Markdown heading appears inside a fenced code block`);
    }
  }
  if (fenced) failures.push(`${label}: unclosed fenced code block`);

  for (const match of source.matchAll(/\]\(\/docs\/([^#?)]+)(?:[#?][^)]*)?\)/g)) {
    const target = match[1].replace(/\/$/, '');
    if (!routes.has(target)) failures.push(`${label}: broken internal docs link /docs/${target}`);
  }
}

if (failures.length) {
  console.error(`Documentation lint failed with ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Documentation lint passed for ${files.length} pages.`);
