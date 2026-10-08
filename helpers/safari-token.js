// Optional iOS Shortcut: "Run JavaScript on Webpage", launched from Safari's
// share sheet after SSO finishes. Pass its output to Copy to Clipboard, then
// paste into My Barcode. Nothing is sent to another server by this helper.
(() => {
  if (location.origin !== 'https://innosoftfusiongo.com' || !location.pathname.startsWith('/sso/login/')) {
    completion(null);
    return;
  }
  const token = document.getElementById('fusionLoginTokenResponse')?.value ||
    new URL(location.href).searchParams.get('fusiontoken');
  completion(typeof token === 'string' && /^[\x21-\x7e]{1,8192}$/.test(token) ? token : null);
})();
