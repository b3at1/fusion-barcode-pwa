# Rec Code

A small, installable web app for displaying your FusionGo membership barcode. It requests a fresh barcode when opened and remembers your login on your device. Texas A&M (institution 107) is the default; other institutions can be selected in Settings.

This is an independent project, not an official FusionGo or institution app.

## Run locally

With Node.js 22 installed, run from the repository folder:

```sh
npm start
```

Open **http://127.0.0.1:4173**. No dependency installation or build step is needed.

For your own hosted copy, see **[HOSTING.md](HOSTING.md)**. It covers Vercel, a Node server, and Docker with HTTPS.

## Connect your login

1. Select **Connect your login → Open institution SSO**.
2. Sign in through your institution.
3. Copy the finished page's full address containing `fusiontoken=…`.
4. Return to Rec Code, paste it, and select **Save login**.

You can also paste the token itself or import a saved token JSON file. Your login is saved only after a valid barcode is returned. Renewing a login requires repeating the import step; returning from SSO is not automatic.

## Use it

- **Refresh barcode** gets a current barcode.
- **Scan view** enlarges it for scanning and keeps the screen awake when supported.
- **Settings** lets you change institutions, download a barcode image, forget a saved login, or add the app to your home screen.

A current barcode needs an internet connection. A downloaded image is a snapshot, and its acceptance or lifetime is not guaranteed.

## Privacy and security

Your token is saved in your device's browser storage, without encryption. To fetch a barcode, it passes through the server hosting this app and then goes to FusionGo. The app does not write tokens or barcode responses to server storage or application logs, and neither is cached by the service worker. There are no analytics or third-party scripts.

Use a host you trust. Self-hosting lets you control the server that handles your token. Other visitors cannot normally access your browser storage, but the site's JavaScript can; a compromised deployment could steal saved tokens. **Forget saved login** removes the local copy, not the token at FusionGo.

The relay includes origin checks, rate limits, restrictive browser security headers, and a fixed upstream destination. These reduce risk; they are not a security guarantee.

## Development

```sh
npm test
```

Tests use synthetic credentials and do not contact FusionGo. The optional `npm run test:browser` command requires Python Playwright and Chromium; setup is in [HOSTING.md](HOSTING.md#checks).

When publishing changed interface assets, increment the cache version in `public/sw.js`.

An optional [Safari Shortcut helper](helpers/safari-token.js) extracts a token from the completed SSO page for copying and pasting into the app.
