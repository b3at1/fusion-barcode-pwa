# Rec Code

A small, user-hosted PWA for FusionGo membership barcodes. The mobile layout uses a white background and black text, with the barcode and essential controls on the main screen. It remembers your Fusion token on your device and requests a fresh barcode when you open it. Institution 107 (Texas A&M) is the default; change the ID in Settings for another institution.

This is an independent project, with no imports from the original Python tools. There are no runtime dependencies, build step, analytics, external fonts, or accounts on this server.

## Run locally

Use Node.js 22, then run:

```sh
cd fusion-barcode-pwa
npm start
```

Open **http://127.0.0.1:4173**. You do not need `npm install`.

1. Select **Connect your login**, then **Open institution SSO**.
2. Complete your institution's login in the new tab.
3. Copy the finished page's full address containing `fusiontoken=…`.
4. Return to Rec Code and paste it into the login field.
5. Select **Save login**. The token is remembered only after it returns a valid barcode.

You can also paste the token itself or expand **Import a saved login** and select **Choose Python token file**. The existing Python tool saves it at `~/.cache/rec-sports/fusiontoken-107.json`, or under `$XDG_CACHE_HOME/rec-sports/` if configured. Choose the file for the institution selected in Settings. File contents are read locally; only the token is sent for barcode retrieval.

Subsequent visits reuse the saved token. If the API rejects it or returns an invalid barcode, the app prompts you to renew it through SSO. A temporary connection or backend failure keeps the saved token and offers a retry. Renewing through this separate website still requires copying the finished SSO URL: FusionGo does not provide a callback to this project, and browsers prevent this page from reading the other site's completion page.

## Daily use

- **Refresh barcode** requests another current barcode.
- **Scan view** shows it on a white screen. The app requests a screen wake lock when supported; it does not control screen brightness.
- **Settings → Save barcode image** downloads a PNG. It is a snapshot; the app does not establish how long it remains accepted.
- **Settings** changes the institution ID and display name. Tokens are stored separately for each institution.
- **Forget saved login** removes the selected institution's local token. It does not revoke the token at FusionGo.
- **Settings → Add to Home Screen** provides installation instructions, or the browser's install prompt when available. If the installed app has separate storage, import the token there once.

The interface can open offline, but a current barcode needs an internet connection. Barcode responses and tokens are never added to the service worker's cache, and a failed refresh clears the previous barcode from the screen.

## Deploy on Vercel

Publish the contents of this folder as the root of your private GitHub repository. Include `api/`, `public/`, `server.js`, the tests, and `vercel.json`. Saved login files, `.env` files, and local Vercel settings are ignored by Git.

1. In Vercel, select **Add New → Project**, connect GitHub, and grant the Vercel GitHub app access to your private repository.
2. Import the repository. Use **Other** as the framework preset and the repository root (`./`) as the Root Directory. If you instead upload this folder inside another repository, select `fusion-barcode-pwa` as the Root Directory.
3. Leave the build settings supplied by `vercel.json`: build command `npm test` and output directory `public`. Node.js 22 is selected by `package.json`. No environment variables, database, Fusion token, or SSO credentials are needed in Vercel.
4. Select **Deploy**. Vercel serves the interface and runs `/api/barcode` and `/api/health` as Node functions on the same origin. The local `npm start` command is not a Vercel build command.
5. Open `https://YOUR-PROJECT.vercel.app/api/health`. Expect `{"service":"my-barcode","relay":true}`. Open the main page, import a completed SSO URL, and check that the barcode appears and returns after reloading.
6. Open the stable production address on each device. Import that device's login once, then use **Settings → Add to Home Screen**.

The two API entry points reuse the same relay handler as the local server. Each function has a 30-second limit; the handler stops waiting for FusionGo after 18 seconds. API responses use `no-store`, and the interface and service worker require cache revalidation. Only `public/` is configured as the static output; backend source files are not published as static assets.

A private GitHub repository keeps the source private; it does not automatically make the deployed website private. Tokens remain in each device's browser storage and are not synced between devices. Use the production address consistently: preview addresses and custom domains have separate browser storage.

If the repository is missing from Vercel's import list, update the Vercel GitHub app's access to include it. For Vercel Hobby, use a repository owned by your personal GitHub account; check Vercel's plan restrictions before using an organization-owned private repository.

Configuration references: [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [project configuration](https://vercel.com/docs/project-configuration/vercel-json), and [GitHub integration](https://vercel.com/docs/git/vercel-for-github).

## Other hosting

Run the Node server on a host you control and put it behind an HTTPS reverse proxy on a dedicated origin. Point the proxy at `127.0.0.1:4173`; [deploy/Caddyfile](deploy/Caddyfile) is a minimal example. Replace its domain with your own and configure DNS before using it. HTTPS is needed for normal phone installation and service worker support; browsers also allow local loopback addresses for development.

The server listens on `127.0.0.1` by default. Set `HOST` and `PORT` through your hosting environment when needed. For example, the included container listens on port 4173:

```sh
docker build -t my-barcode .
docker run --rm -p 127.0.0.1:4173:4173 my-barcode
```

Keep the reverse proxy on the same host for that example. Opening the HTTP server directly over a phone's LAN connection does not supply HTTPS or the secure context needed for installation. Use the HTTPS address for real tokens.

### Barcode requests

The browser always requests a barcode through the included same-origin relay:

```text
Browser → this site's POST /api/barcode → FusionGo's GET /sso/api/barcode.php?id=107
```

The token travels in an `Authorization: Bearer …` header on both requests. No session cookies are required. The relay accepts only an institution ID and forwards only to the fixed FusionGo barcode endpoint. It does not save tokens, barcodes, or request logs, and it returns generic errors rather than upstream stack traces.

The relay must run on Node, either in Vercel Functions or the standalone server. Serving only `public/` on a static host does not provide the relay. There is no connection selector or browser fallback to FusionGo. Existing saved connection preferences are ignored; saved tokens and institution settings remain usable.

Tokens are stored in this origin's `localStorage`, without encryption. Treat the browser profile and hosting origin as trusted: the site's JavaScript can read its saved tokens, and the relay host processes them in memory. Keep request-header/body logging disabled in any proxy or hosting configuration. The Node server supplies a restrictive Content Security Policy, a no-referrer policy, and no-store API headers.

### Connection troubleshooting

If importing the SSO URL fails to connect, open the PWA served by `npm start` at **http://127.0.0.1:4173**. Live Server, `python -m http.server`, and hosts serving only `public/` do not run the barcode relay.

Open **http://127.0.0.1:4173/api/health** without any token. The included server returns `{"service":"my-barcode","relay":true}`. A missing route or an HTML page means that address is not serving the relay. For a deployed site, check `/api/health` at that site's address and ensure its proxy routes `/api/` to the Node server.

The app distinguishes an unreachable relay from a missing relay. Connection errors do not establish that the Fusion token is expired. After updating the app, reload it to activate the new interface cache.

## Optional Safari share-sheet helper

[helpers/safari-token.js](helpers/safari-token.js) is a script for an Apple Shortcut that extracts the token from the finished FusionGo page. It can read the page's `fusionLoginTokenResponse` input if the address is inconvenient to copy.

1. Create a Shortcut that appears in the Share Sheet and accepts Safari web pages.
2. Add **Run JavaScript on Web Page**, pass it the Shortcut input, and replace its script with the helper file's contents.
3. Add **Copy to Clipboard** using the JavaScript result. A failed extraction returns `null`; optionally check for a result before copying.
4. After completing SSO in Safari, run this Shortcut from Share, then paste into Rec Code.

This helper does not send anything over the network or automate the return to the PWA. See Apple's [Run JavaScript on Web Page guide](https://support.apple.com/guide/shortcuts/use-the-run-javascript-on-webpage-action-apdb71a01d93/ios).

## Development and checks

```sh
npm test
```

The dependency-free Node tests cover Code 128 reference vectors, per-institution token storage, import validation, API and relay requests, error handling, service worker exclusions, and the actual app's event handlers using a simulated DOM. They also exercise the Vercel function entry points with HTTPS request headers and verify the deployment configuration. They use synthetic tokens and barcodes and make no requests to FusionGo.

An optional Chromium smoke test checks the rendered mobile UI, PNG download, reload, and renewal flows with synthetic network responses:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install playwright
.venv/bin/python -m playwright install chromium
.venv/bin/python tests/browser_smoke.py
```

If Playwright is already available to `python3`, use `npm run test:browser`. The test saves `test-results/mobile.png`; generated test files and virtual environments are ignored by Git. This browser test blocks service workers; the Node suite checks their cache behavior separately.

The local Node checks pass, including the Vercel adapters. The agent environment blocks browser launch, local listening sockets, and live network verification. A Vercel build and deployment have not been run here; use the health endpoint and barcode checks above after deploying. Phone installation, scanner acceptance, and container deployment require validation on the target device or host.

### Structure

```text
api/                 Vercel function entry points for the shared relay handler
public/              Installable interface, local renderer, storage and API client
server.js            Static server and fixed-endpoint stateless relay
vercel.json          Static output, test command, function limits and headers
helpers/             Optional Safari share-sheet token extractor
tests/               Node suite and optional Chromium smoke test
deploy/Caddyfile      Example HTTPS proxy configuration
Dockerfile           Dependency-free Node container
```

The renderer encodes the entire API value, including ampersands and leading zeros, as Code 128. It does not derive the identifier from a token or user ID. On publishing changed interface files, bump the cache version in `public/sw.js` so installations receive the updated shell.

Browser behavior references: [service workers and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), [screen wake lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
