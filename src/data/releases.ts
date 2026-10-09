// Generated data lives in releases.json; regenerate with `node scripts/sync-releases.mjs`.
import data from './releases.json';

export interface Release { version: string; date: string; headline: string; url: string }

export const releases: Release[] = data;
export const latest = releases[0];

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Headlines carry markdown code spans and nothing else once the sync script has flattened them.
export const headlineHtml = (s: string) => escape(s).replace(/`([^`]+)`/g, '<code>$1</code>');
