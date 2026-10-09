# Hosting Rec Code

Run your own copy on Vercel or a server you control. Each copy needs both the web interface and the Node barcode relay. Static-only hosting, including GitHub Pages, is not enough.

No database, server-side Fusion credentials, or environment secrets are required. Each user imports their own login on their device. See the [README](README.md) for the login steps.

## Get the code

Fork or download the repository, or clone your copy:

```sh
git clone <your-repository-url> rec-code
cd rec-code
```

For local use, install Node.js 22 and run `npm start`. Open **http://127.0.0.1:4173**. No `npm install` or asset build is needed.

## Vercel

1. Fork the repository into your GitHub account. It can be public or private.
2. In Vercel, add a project and import that repository.
3. Use **Other** as the framework preset and the repository root as the Root Directory.
4. Keep the settings from `vercel.json`: build command **`npm test`**, output directory **`public`**, and Node.js **22**. No environment variables are needed.
5. Deploy, then open `https://YOUR-PROJECT.vercel.app/api/health`. It should return:

   ```json
   {"service":"my-barcode","relay":true}
   ```

6. Open the main page, import your login, and check that the barcode appears and returns after reloading.

Vercel serves `public/` and runs `api/barcode.js` and `api/health.js` as Node functions. Both use the same relay handler as the local server. Do not use `npm start` as the Vercel build command.

Use the stable production URL on your devices. Preview URLs and custom domains have separate browser storage. A private repository does not make the deployed website private. If Vercel cannot find the repository, check the Vercel GitHub app's repository access.

## Your own server

You need Node.js 22, a domain pointing at your server, and an HTTPS reverse proxy such as Caddy.

1. Put the repository on the server and run `npm test`.
2. Run `npm start` under a service manager so it stays running and restarts after a reboot. The default listener is **127.0.0.1:4173**; `HOST` and `PORT` can override it.
3. Configure your proxy with your domain. The included [deploy/Caddyfile](deploy/Caddyfile) is a starting point:

   ```caddyfile
   barcode.your-domain.example {
       reverse_proxy 127.0.0.1:4173
   }
   ```

4. Replace the example domain, configure DNS, and start or reload Caddy. Its normal automatic HTTPS setup requires the domain to reach your server and the required HTTP/HTTPS ports to be accessible.
5. Check `https://YOUR-DOMAIN/api/health`, then import a login on the main page.

Proxy the whole site, including `/api/`, and preserve the public Host header. Keep the Node port private. Opening the app over a phone's plain HTTP LAN connection does not provide the secure context needed for normal installation.

## Docker

Instead of installing Node on the host, build and run the included container:

```sh
docker build -t rec-code .
docker run -d --name rec-code --restart unless-stopped -p 127.0.0.1:4173:4173 rec-code
```

Use the HTTPS proxy setup above on the same host, pointing at `127.0.0.1:4173`. The container runs as a non-root user and needs no token files or persistent data volume. If the proxy runs in another container, use a private container network and adjust its upstream address.

After code changes, rebuild the image and recreate the container. The running container does not automatically pick up repository edits.

## Security when hosting

- Serve on a dedicated HTTPS origin. The hosting server receives tokens in memory to forward them to FusionGo; users must trust its operator.
- Keep Authorization headers, request bodies, and token-containing SSO URLs out of proxy logs, analytics, tracing, and error reports. The app itself does not log them.
- Preserve the configured security and cache headers. API responses must remain `no-store`; do not enable cross-origin access to the relay.
- Protect your GitHub and hosting accounts and review changes before publishing. Modified JavaScript can read saved browser tokens.
- Never commit `.env` files or saved login files. No real token is needed for builds or tests.

The relay accepts requests with a matching Origin or `Sec-Fetch-Site: same-origin` evidence. It rejects cross-origin and sibling-site requests, browser navigations, and HTTP origins outside loopback development. These checks restrict browsers; automated clients can forge the headers.

Each handler instance allows 12 upstream attempts per token per minute, 120 total per minute, and 8 simultaneous upstream requests. Rejected requests return 429 with `Retry-After: 60`. Only temporary keyed token fingerprints are retained for counting. Serverless instances have separate counters, and restarts reset them; broadly shared sites should also use hosting-level rate limits or firewall rules.

Both hosting paths send a restrictive Content Security Policy, opener/resource isolation, permission restrictions, and HSTS with a one-year lifetime. HSTS takes effect after an HTTPS visit, without a subdomain or preload policy. Screen wake lock remains allowed.

Tokens remain unencrypted in browser storage. Self-hosting changes who controls the relay; it does not remove the risks of a compromised browser or deployment. Forgetting a login does not revoke it at FusionGo.

## Checks

Run the automated suite before publishing:

```sh
npm test
```

For the optional Chromium smoke test:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install playwright
.venv/bin/python -m playwright install chromium
.venv/bin/python tests/browser_smoke.py
```

If Playwright is already available to `python3`, use `npm run test:browser`. It uses synthetic responses and blocks service workers; the Node suite checks cache behavior separately.

After deployment, check `/api/health`, import a login, refresh, reload, and try installation and scanning on your phone. Automated tests do not establish live FusionGo availability or scanner acceptance.

## Troubleshooting and updates

- **Missing relay:** `/api/health` returns HTML or 404. Check that the Node server or Vercel functions are running; serving only `public/` does not work.
- **Temporary failure:** retry later. A connection failure does not establish that your token expired; the app keeps saved logins on temporary failures.
- **Login needs renewing:** use official SSO and explicitly import the new completed URL or token.
- **Different device or domain:** import the login again. Tokens are not synced between browser storage locations.

When publishing changed shell assets, increment the cache version in `public/sw.js`, run the tests, and restart or redeploy. Keep the manifest icons, service worker asset list, and server asset allowlist aligned.
