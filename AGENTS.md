# Project guidance

This folder is a standalone repository. Do not introduce imports or runtime dependencies on the sibling reverse-engineering/Python project.

- Runtime: Node.js 22, browser ES modules, plain HTML/CSS. `npm start` serves on `127.0.0.1:4173`; there is no asset compilation step.
- Vercel serves `public/` with the Other framework preset and `api/barcode.js` plus `api/health.js` as Node functions. Both reuse `createHandler` from `server.js`. Keep local-server and Vercel behavior aligned, including the security and cache headers in `vercel.json`. Vercel runs `npm test` before publishing.
- Keep the mobile UI minimal: white background, black text, and the barcode plus essential controls on the main screen. Put secondary actions in Settings and avoid slogans or decorative components. Use comfortable tap targets and 16px form inputs.
- Run `npm test` after logic changes. The aggregate runner uses `node:test` in one process. `npm run test:browser` is optional and requires Python Playwright plus Chromium.
- Keep tokens out of URLs, logs, thrown errors, analytics, screenshots, and the service worker cache. Use synthetic credentials in tests.
- Store tokens per institution, only after a valid barcode response. Keep them on temporary service failures. Never persist barcode responses or portray an old barcode as freshly fetched.
- The relay may send requests only to the fixed FusionGo barcode endpoint. Preserve body/response limits, redirect rejection, generic errors, same-origin checks, and no-store headers.
- Browser barcode requests always use the same-origin relay. Do not add direct requests to FusionGo or a connection-mode selector; ignore any legacy connection preference.
- Preserve the exact API barcode value, including delimiters and leading zeros. Encode it locally as Code 128.
- Renew login through official SSO with an explicit import step. There is no configured provider callback to this app; do not claim cross-origin completion capture works automatically.
- When publishing changed shell assets, increment the service worker cache version. Keep manifest icons, the shell cache, and the server asset allowlist consistent.
- Update README when commands, hosting assumptions, or user flows change. Report browser, scanner, and deployment checks separately from simulated tests.
