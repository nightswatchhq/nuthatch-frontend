import type { APIRoute } from 'astro';
import { paletteIndex } from '../lib/palette';

// Fetched the first time the palette opens, so a reader who never searches never pays for it.
export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await paletteIndex()), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
