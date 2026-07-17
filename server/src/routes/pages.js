/*
 * ☆ Public pages + manifest
 * -> the unauthenticated surface: root info, health check, and the little login/test pages,
 *    all local now, no cloud login screens anywhere
 *
 * -> the login page asks the server its mode first, then shows just the fields you actually
 *    need, a pin box, a password box, or username + password, whatever fits
 */

import {Router} from 'express';
import {
	SERVER_VERSION,
	SERVER_NAME,
	SERVER_DESCRIPTION,
	SERVER_PICTURE,
	MIN_VERSION,
	AUTH_MODE,
	AUTH_ALLOW_SIGNUP,
} from '../config.js';

export const pagesRouter = Router();

pagesRouter.get('/', (req, res) => {
	res.json({name: 'Starl Audio Server', status: 'ok', docs: '/test'});
});

pagesRouter.get('/health', (req, res) => {
	res.json({status: 'ok'});
});

// server info for a connecting client, everything the app needs to show + know, on the api port
// (the pretty /status.json lives on the page port, this is the plain one clients read)
pagesRouter.get('/info', (req, res) => {
	res.json({
		name: SERVER_NAME,
		description: SERVER_DESCRIPTION,
		picture: SERVER_PICTURE,
		version: SERVER_VERSION,
		min_version: MIN_VERSION,
		auth: {mode: AUTH_MODE, allow_signup: AUTH_ALLOW_SIGNUP},
	});
});

// minimal token-paste test harness (same idea as before, just for poking at the api)
pagesRouter.get('/test', (req, res) => {
	res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Starl Test</title></head>
<body>
  <h1>Starl Test</h1>
  <p>Paste an access token (grab one from <a href="/login">/login</a>), then search and play audio.</p>
  <label>Access Token</label><br /><textarea id="token" rows="4" cols="80"></textarea><br /><br />
  <label>YouTube URL</label><br /><input id="url" size="80" placeholder="https://music.youtube.com/watch?v=..." /><br /><br />
  <label>Search</label><br /><input id="searchQuery" size="60" placeholder="artist or song" />
  <select id="searchKind"><option value="all">all</option><option value="music">music</option>
  <option value="channels">channels</option><option value="playlists">playlists</option></select>
  <button id="search">Search</button><br /><br />
  <label>Quality</label><br /><select id="quality"><option value="best">best</option>
  <option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select><br /><br />
  <button id="download">Download</button>
  <pre id="output"></pre><audio id="player" controls></audio>
  <script>
    const output = document.getElementById('output');
    const player = document.getElementById('player');
    const tokenField = document.getElementById('token');
    const stored = localStorage.getItem('starl_access_token');
    if (stored) tokenField.value = stored;
    document.getElementById('download').addEventListener('click', async () => {
      output.textContent = '';
      const token = tokenField.value.trim();
      const url = document.getElementById('url').value.trim();
      const quality = document.getElementById('quality').value;
      if (!token || !url) { output.textContent = 'Token and URL are required.'; return; }
      const res = await fetch('/download', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ url, quality }) });
      const data = await res.json();
      output.textContent = JSON.stringify(data, null, 2);
      if (res.ok && data.stream_url) {
        const audioRes = await fetch(data.stream_url, { headers: { 'Authorization': 'Bearer ' + token } });
        player.src = URL.createObjectURL(await audioRes.blob());
        player.load();
      }
    });
    document.getElementById('search').addEventListener('click', async () => {
      output.textContent = '';
      const token = tokenField.value.trim();
      const query = document.getElementById('searchQuery').value.trim();
      const kind = document.getElementById('searchKind').value;
      if (!token || !query) { output.textContent = 'Token and query are required.'; return; }
      const res = await fetch('/search', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ query, limit: 5, kind }) });
      const data = await res.json();
      output.textContent = JSON.stringify(data, null, 2);
      if (res.ok && data.items && data.items[0]) document.getElementById('url').value = data.items[0].url;
    });
  </script>
</body></html>`);
});

// local login page, it asks the server its mode and shows just the right fields, no cloud stuff
pagesRouter.get('/login', (req, res) => {
	res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>Login</title></head>
<body>
  <h1>Starl Login</h1>
  <p id="modeLine">checking how this server logs you in...</p>

  <div id="fields"></div>
  <button id="loginBtn">Login</button>
  <button id="registerBtn" style="display:none">Register</button>
  <button id="logout">Logout</button>

  <p><a href="/test">go to the test page</a></p>
  <pre id="output"></pre>
  <script>
    const output = document.getElementById('output');
    const fields = document.getElementById('fields');
    const registerBtn = document.getElementById('registerBtn');
    let mode = 'userpass';

    // draw the right inputs for whatever mode the server is in
    function drawFields() {
      if (mode === 'none') { fields.innerHTML = '<p>this server is open, just hit login</p>'; return; }
      if (mode === 'pin') { fields.innerHTML = '<label>PIN</label><br /><input id="pin" type="password" /><br /><br />'; return; }
      if (mode === 'password') { fields.innerHTML = '<label>Password</label><br /><input id="password" type="password" /><br /><br />'; return; }
      fields.innerHTML = '<label>Username</label><br /><input id="username" /><br /><label>Password</label><br /><input id="password" type="password" /><br /><br />';
    }

    // gather up whatever fields the mode uses into a little body for the request
    function loginBody() {
      if (mode === 'pin') return { pin: document.getElementById('pin').value };
      if (mode === 'password') return { password: document.getElementById('password').value };
      if (mode === 'userpass') return {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      };
      return {};
    }

    function saveSession(data) {
      if (data.access_token) localStorage.setItem('starl_access_token', data.access_token);
      if (data.refresh_token) localStorage.setItem('starl_refresh_token', data.refresh_token);
      output.textContent = JSON.stringify(data, null, 2);
    }

    async function post(path, body) {
      const res = await fetch(path, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { ok: res.ok, data: await res.json() };
    }

    document.getElementById('loginBtn').addEventListener('click', async () => {
      const { ok, data } = await post('/auth/login', loginBody());
      if (ok) saveSession(data); else output.textContent = (data.detail || 'login failed');
    });

    registerBtn.addEventListener('click', async () => {
      const { ok, data } = await post('/auth/register', loginBody());
      if (ok) saveSession(data); else output.textContent = (data.detail || 'register failed');
    });

    document.getElementById('logout').addEventListener('click', async () => {
      const token = localStorage.getItem('starl_access_token');
      if (token) await fetch('/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
      localStorage.removeItem('starl_access_token');
      localStorage.removeItem('starl_refresh_token');
      output.textContent = 'logged out';
    });

    // kick things off, ask the server its mode then set the page up to match
    (async () => {
      try {
        const res = await fetch('/auth/mode');
        const info = await res.json();
        mode = info.mode || 'userpass';
        document.getElementById('modeLine').textContent = 'this server uses: ' + mode;
        if (mode === 'userpass' && info.allow_signup) registerBtn.style.display = '';
        drawFields();
      } catch (err) {
        document.getElementById('modeLine').textContent = 'couldnt reach the server';
      }
    })();
  </script>
</body></html>`);
});
