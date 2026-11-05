// Redirect to the custom domain when BASE_URL is set.
process.env.NODE_ENV = 'test';
process.env.BASE_URL = 'https://www.ofie.com.gh';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { open } = require('../src/db');
const { createApp } = require('../src/app');

let server, port;
before(async () => {
  server = createApp(open(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
});
after(() => server.close());

// fetch() won't let us set the Host header, so use http.request.
const get = (path, host, method = 'GET') => new Promise((resolve, reject) => {
  http.request({ port, path, method, headers: { host } }, (res) => { res.resume(); resolve(res); }).on('error', reject).end();
});

test('other hosts are redirected to the custom domain, keeping the path', async () => {
  const r = await get('/listings?area=Osu', 'ofie-accra.onrender.com');
  assert.equal(r.statusCode, 301);
  assert.equal(r.headers.location, 'https://www.ofie.com.gh/listings?area=Osu');
});

test('the custom domain itself and health checks are served normally', async () => {
  assert.equal((await get('/', 'www.ofie.com.gh')).statusCode, 200);
  assert.equal((await get('/healthz', 'ofie-accra.onrender.com')).statusCode, 200);
});

test('form posts are not redirected (they would lose their data)', async () => {
  assert.notEqual((await get('/login', 'ofie-accra.onrender.com', 'POST')).statusCode, 301);
});
