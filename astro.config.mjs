// @ts-check
import { defineConfig } from 'astro/config';

// Static output only. No islands, no adapters, no telemetry, no external scripts.
// The site's pitch is "nothing phones home" - the build practises it.
export default defineConfig({
  site: 'https://www.nuthatch-indexer.com',
  output: 'static',
  compressHTML: true,
  build: {
    // Inline all CSS into each page: zero extra stylesheet requests, and the
    // landing page stays a single small document. Fonts are the only sub-resources.
    inlineStylesheets: 'always',
  },
  // Astro sends no telemetry when ASTRO_TELEMETRY_DISABLED is set; we also
  // disable it in the build script environment. No client runtime is shipped.
  devToolbar: { enabled: false },
});
