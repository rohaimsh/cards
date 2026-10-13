'use strict';
/* The one function of the GCS relay: /api/gcs/<name>. All the decisions are in ../relay.js (plain code, tested without Azure); this file only hands the request over. */
const { app } = require('@azure/functions');
const { relay, ROUTES } = require('../relay');

const MOST = Math.max.apply(null, Object.keys(ROUTES).map(function (n) { return ROUTES[n].max || 0; }));

app.http('gcs', {
  route: 'gcs/{name}',
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async function (request, context) {
    const h = request.headers;
    let body = '';
    if (request.method === 'POST') {
      // a body larger than any route allows is refused before it is read
      if (Number(h.get('content-length') || 0) > MOST + 1024) return { status: 413, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }, body: '{"ok":false,"error":"too large"}' };
      body = await request.text();
    }
    const out = await relay({
      method: request.method,
      name: request.params && request.params.name,
      query: Object.fromEntries(request.query),
      body: body,
      origin: h.get('origin'),
      host: String(h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim(),
      fetchSite: h.get('sec-fetch-site'),
      env: process.env,
      fetch: fetch,
      log: function (line) { context.log(line); }
    });
    return { status: out.status, headers: out.headers, body: out.body };
  }
});
