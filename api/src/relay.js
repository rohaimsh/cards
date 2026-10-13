'use strict';
/* The GCS relay: what sits between the pages and the Power Automate flows.

   Why it exists. The address of a flow carries a secret key (sig=). A page that holds the address shows the key to everyone who opens the page's source, and a public
   repository keeps it for ever. Here the pages call /api/gcs/<name> on their own address; this code adds the key (it comes from the app's settings, never from a page or from the
   repository) and passes the request on to the flow.

   What it does not do. It does not decide who may do what: every flow still checks the Microsoft sign-in itself (tenant, admin list), exactly as before, and the three public flows
   (card, vcard, track) are public on purpose. The relay only
     1. keeps the keys out of sight (a page, the repository, a log, an answer);
     2. accepts the seven known routes, with the right method, size and shape, and nothing else;
     3. refuses a browser request that comes from another site;
     4. never passes on what the platform says when it refuses a request (it names the flow and the trigger), only the flow's own answer;
     5. logs the route name, the status and the time, nothing else.
   It is plain code with no outside package, so tests/test_api_relay.js runs it without Azure.

   Settings (Static Web App > Environment variables, or tools/protect_flow_keys.py): FLOW_CARD, FLOW_TRACK, FLOW_VCARD, FLOW_READER, FLOW_SAVE, FLOW_PUBLISH, FLOW_ADMIN.
   Each one is the whole address of that flow. They are secrets: nobody pastes them into a file. */

const KB = 1024, MB = 1024 * 1024;
const ROUTES = Object.freeze({
  ping:    { methods: ['GET'] },                                                  // no flow: tells a deploy check that the relay is there
  card:    { env: 'FLOW_CARD',    methods: ['POST'], max: 20 * KB },                // GCS Get card: a published card, and a visitor's lead
  track:   { env: 'FLOW_TRACK',   methods: ['POST'], max: 4 * KB },                 // GCS Track: one page view or tap, counts only
  vcard:   { env: 'FLOW_VCARD',   methods: ['GET'], query: { id: /^[A-Za-z0-9_-]{6,40}$/, d: /^[A-Za-z0-9_-]{1,6000}$/ } },   // GCS vCard: a contact file (d = the card as base64url, for a card that is not published; a long address in Arabic still fits)
  reader:  { env: 'FLOW_READER',  methods: ['POST'], max: 8 * MB },                 // GCS Card reader: a card photo
  save:    { env: 'FLOW_SAVE',    methods: ['POST'], max: 200 * KB },               // GCS Save contact
  publish: { env: 'FLOW_PUBLISH', methods: ['POST'], max: 600 * KB },               // GCS Publish my card
  admin:   { env: 'FLOW_ADMIN',   methods: ['POST'], max: 20 * KB }                 // GCS Admin
});
const FLOW_ROUTES = Object.keys(ROUTES).filter(function (n) { return ROUTES[n].env; });
const HOST_OK = /(^|\.)(powerplatform\.com|logic\.azure\.com)$/i;                   // where a flow address may point; a setting that points anywhere else is refused
const ANSWER_MAX = 4 * MB, TIMEOUT_MS = 42000;                                      // the platform gives a request 45 seconds, so a slow flow ends here with our own 502 first

function headersFor(extra) {
  return Object.assign({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra || {});
}
function reply(status, obj, extra) {
  return { status: status, headers: headersFor(Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, extra)), body: JSON.stringify(obj) };
}

/* the whole address of a flow from the settings, or '' when it is missing or does not look like one */
function flowUrl(value, hostOk) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v || /[\s"'<>\\\x00-\x1f\x7f]/.test(v)) return '';
  let u;
  try { u = new URL(v); } catch (e) { return ''; }
  if (u.protocol !== 'https:' && !(hostOk && u.protocol === 'http:')) return '';       // plain http only when a test says so
  if (!(hostOk ? hostOk(u.hostname) : HOST_OK.test(u.hostname))) return '';
  return v;
}

/* req: { method, name, query: {name: value}, body: string, origin, host, fetchSite, env, fetch, log, hostOk?, timeoutMs? }  ->  { status, headers, body } */
async function relay(req) {
  const t0 = Date.now(), log = typeof req.log === 'function' ? req.log : function () {};
  const name = String(req.name || ''), method = String(req.method || '').toUpperCase();
  const done = function (out) { log(name.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) + ' ' + out.status + ' ' + (Date.now() - t0) + 'ms'); return out; };
  const route = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;
  if (!route) return done(reply(404, { ok: false, error: 'not found' }));
  if (route.methods.indexOf(method) < 0) return done(reply(405, { ok: false, error: 'method not allowed' }, { Allow: route.methods.join(', ') }));
  const env = req.env || {}, hostOk = req.hostOk || null;

  if (name === 'ping') {
    const n = FLOW_ROUTES.filter(function (r) { return flowUrl(env[ROUTES[r].env], hostOk); }).length;
    return done(reply(200, { ok: true, relay: 1, configured: n, of: FLOW_ROUTES.length }));       // counts only: never a name, never an address
  }

  // a browser request must come from our own site (a script, curl and a phone browser opening a link send no Origin and are not affected)
  if (method === 'POST') {
    if (req.origin && req.host) {
      let o = '';
      try { o = new URL(String(req.origin)).host.toLowerCase(); } catch (e) { o = ''; }
      if (o !== String(req.host).toLowerCase()) return done(reply(403, { ok: false, error: 'wrong origin' }));
    }
    if (String(req.fetchSite || '').toLowerCase() === 'cross-site') return done(reply(403, { ok: false, error: 'wrong origin' }));
  }

  // the shape of the request: size and JSON for a POST, two checked values for a GET
  const pairs = [];
  const body = typeof req.body === 'string' ? req.body : '';
  if (method === 'POST') {
    if (Buffer.byteLength(body, 'utf8') > route.max) return done(reply(413, { ok: false, error: 'too large' }));
    let j = null;
    try { j = JSON.parse(body); } catch (e) { j = null; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return done(reply(400, { ok: false, error: 'bad request' }));
  } else {
    const q = req.query || {};
    let bad = false;
    Object.keys(route.query).forEach(function (k) {
      const v = q[k];
      if (v === undefined || v === null || v === '') return;
      if (typeof v !== 'string' || !route.query[k].test(v)) { bad = true; return; }
      pairs.push(k + '=' + encodeURIComponent(v));                                          // only these values go on; anything else a caller adds is dropped
    });
    if (bad || !pairs.length) return done(reply(400, { ok: false, error: 'bad request' })); // a contact file needs an id or the data
  }

  const url = flowUrl(env[route.env], hostOk);
  if (!url) return done(reply(503, { ok: false, error: 'not configured' }));

  let res, text;
  try {
    res = await req.fetch(pairs.length ? url + (url.indexOf('?') < 0 ? '?' : '&') + pairs.join('&') : url, {
      method: method,
      headers: method === 'POST' ? { 'Content-Type': 'text/plain' } : {},
      body: method === 'POST' ? body : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(req.timeoutMs || TIMEOUT_MS)
    });
    text = await res.text();
  } catch (e) {
    return done(reply(502, { ok: false, error: 'upstream' }));                              // never the reason: it can hold the address
  }
  if (text.length > ANSWER_MAX) return done(reply(502, { ok: false, error: 'upstream' }));

  const ctype = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
  if (res.status < 400) {
    if (name === 'vcard') {
      if (!ctype.startsWith('text/vcard')) return done(reply(502, { ok: false, error: 'upstream' }));
      const extra = { 'Content-Type': 'text/vcard; charset=utf-8' };
      const cd = String(res.headers.get('content-disposition') || '');
      if (/^(inline|attachment)(; ?filename="?[A-Za-z0-9._ -]{1,80}"?)?$/i.test(cd)) extra['Content-Disposition'] = cd;
      return done({ status: res.status, headers: headersFor(extra), body: text });
    }
    return done({ status: res.status, headers: headersFor({ 'Content-Type': 'application/json; charset=utf-8' }), body: text });
  }
  // a refusal: pass on only the flow's own answer ({"ok":false,...}); what the platform says about a key or a flow stays here
  if (name === 'vcard' && res.status === 404 && text.trim() === 'Card not found') return done({ status: 404, headers: headersFor({ 'Content-Type': 'text/plain; charset=utf-8' }), body: 'Card not found' });   // the contact file flow's own words (a page opened in a browser tab)
  let obj = null;
  try { obj = JSON.parse(text); } catch (e) { obj = null; }
  if (obj && typeof obj === 'object' && obj.ok === false) return done({ status: res.status, headers: headersFor({ 'Content-Type': 'application/json; charset=utf-8' }), body: text });
  if (res.status === 429) return done(reply(429, { ok: false, error: 'busy' }));
  return done(reply(502, { ok: false, error: 'upstream' }));
}

module.exports = { relay, ROUTES, FLOW_ROUTES, flowUrl };
