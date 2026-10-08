// A stopgap subgraph's page URL also answers GraphQL. People paste the page link into their app as
// its query URL, and a static page answers a POST with 405, so POST and its preflight are forwarded
// to the endpoint; every other request carries on to the page.
export const config = { matcher: ['/subgraphs/:id', '/subgraphs/:id/'] };

const DEPLOYMENT = /^\/subgraphs\/(Qm[1-9A-HJ-NP-Za-km-z]{44})\/?$/;
const UPSTREAM = 'https://subgraphs.nuthatch-indexer.com/subgraphs/id/';

export default async function middleware(request: Request): Promise<Response> {
  const m = new URL(request.url).pathname.match(DEPLOYMENT);
  if (!m || (request.method !== 'POST' && request.method !== 'OPTIONS')) {
    return new Response(null, { headers: { 'x-middleware-next': '1' } });
  }
  const headers = new Headers();
  for (const h of ['content-type', 'accept', 'origin', 'access-control-request-method', 'access-control-request-headers']) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  const upstream = await fetch(UPSTREAM + m[1], {
    method: request.method,
    headers,
    body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
  });
  return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
}
