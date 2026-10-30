import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_USERNAME = 'test-owner';
process.env.AUTH_PASSWORD = 'test-password-that-is-long-enough';
process.env.AUTH_SECRET = 'test-secret-with-more-than-thirty-two-characters';
const { app } = await import('../src/index.js');
const { validateAuthConfiguration } = await import('../src/lib/auth.js');

test('all application APIs require a signed-in session', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, options);

  try {
    assert.equal((await request('/api/meta')).status, 401);
    assert.deepEqual(await (await request('/api/auth/session')).json(), { authenticated: false });
    assert.equal((await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'test-owner', password: 'wrong-password' }),
    })).status, 401);
    assert.equal((await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ username: 'test-owner', password: process.env.AUTH_PASSWORD }),
    })).status, 403);

    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: process.env.AUTH_USERNAME, password: process.env.AUTH_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.ok(!cookie.startsWith('sales_crm_session=;'));

    const session = await request('/api/auth/session', { headers: { cookie: cookie.split(';', 1)[0] } });
    assert.deepEqual(await session.json(), { authenticated: true, username: 'test-owner' });

    const logout = await request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: cookie.split(';', 1)[0] },
    });
    assert.equal(logout.status, 200);
    assert.equal((await request('/api/auth/session', { headers: { cookie: logout.headers.get('set-cookie') } })).status, 200);
    assert.deepEqual(await (await request('/api/auth/session')).json(), { authenticated: false });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failedLogin = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'test-owner', password: 'wrong-password' }),
      });
      assert.equal(failedLogin.status, 401);
    }
    const limited = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'test-owner', password: process.env.AUTH_PASSWORD }),
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);

    const configuredPassword = process.env.AUTH_PASSWORD;
    process.env.AUTH_PASSWORD = 'replace-with-a-default-password';
    assert.throws(() => validateAuthConfiguration(), /placeholder/);
    process.env.AUTH_PASSWORD = configuredPassword;
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
