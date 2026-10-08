import { barcodeSvg, barcodeGeometry } from './lib/barcode.js';
import { ApiError, extractToken, loginUrl, validateSchoolId } from './lib/response.js';
import { TokenVault, readSettings, saveSettings } from './lib/state.js';
import { BarcodeApi } from './lib/api.js';

const $ = id => document.getElementById(id);
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const vault = new TokenVault(storage);
const api = new BarcodeApi();
let settings = readSettings(storage);
let barcode = null;
let operation = 0;
let controller = null;
let lastAttempt = 0;
let wakeLock = null;
let installPrompt = null;

function institutionName() { return settings.name || `Institution ${settings.schoolId}`; }
function showDialog(id) { if (!$(id).open) $(id).showModal(); }
function notice(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}
function setStatus(text) { $('status-label').textContent = text; }
function updateInstitution() {
  $('institution-name').textContent = institutionName();
  $('login-title').textContent = `Connect ${institutionName()}`;
  $('sso-link').href = loginUrl(settings.schoolId);
}
function clearBarcode() {
  barcode = null;
  $('barcode-slot').replaceChildren();
  $('barcode-slot').hidden = true;
  $('scan-barcode').replaceChildren();
  if ($('scan-dialog').open) $('scan-dialog').close();
  $('scan-button').hidden = true;
  $('download-button').hidden = true;
  releaseWakeLock();
}
function cancelRequest() {
  operation++;
  controller?.abort();
  controller = null;
  $('import-button').disabled = false;
  $('import-button').textContent = 'Save login';
  $('refresh-button').disabled = false;
}
function emptyState(message = 'Sign in once to save your login on this device.') {
  clearBarcode();
  $('loading-state').hidden = true;
  $('empty-state').hidden = false;
  $('empty-message').textContent = message;
  $('connect-button').hidden = false;
  $('refresh-button').hidden = !vault.get(settings.schoolId);
  $('updated-label').textContent = '';
}
function openLogin() {
  updateInstitution();
  $('login-error').hidden = true;
  showDialog('login-dialog');
}
async function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  try { await lock?.release(); } catch { /* Optional screen convenience. */ }
}
async function keepScreenAwake() {
  if (!barcode || document.visibilityState !== 'visible' || !navigator.wakeLock || wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!barcode || document.visibilityState !== 'visible') { await lock.release(); return; }
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  } catch { /* Not available on every browser; barcode display still works. */ }
}

async function loadBarcode(token = vault.get(settings.schoolId)?.token, save = false) {
  cancelRequest();
  notice();
  if (!token) { emptyState(); setStatus('Not connected'); return; }
  const currentOperation = operation;
  const institution = settings.schoolId;
  controller = new AbortController();
  lastAttempt = Date.now();
  clearBarcode();
  $('empty-state').hidden = true;
  $('loading-state').hidden = false;
  $('connect-button').hidden = true;
  $('refresh-button').hidden = false;
  $('refresh-button').disabled = true;
  $('import-button').disabled = true;
  $('import-button').textContent = 'Getting your barcode…';
  setStatus('Fetching');
  try {
    const result = await api.get(institution, token, controller.signal);
    if (currentOperation !== operation || institution !== settings.schoolId) return;
    const persistent = !save || vault.put(institution, token);
    barcode = result.barcode;
    $('barcode-slot').innerHTML = barcodeSvg(barcode);
    $('barcode-slot').hidden = false;
    $('loading-state').hidden = true;
    $('empty-state').hidden = true;
    $('scan-button').hidden = false;
    $('download-button').hidden = false;
    $('updated-label').textContent = 'Fetched ' + new Date(result.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setStatus('Ready to scan');
    if (save) {
      $('token-input').value = '';
      $('login-dialog').close();
      if (!persistent) notice('Browser storage is unavailable. Your login will last for this session only.');
    }
    await keepScreenAwake();
  } catch (error) {
    if (currentOperation !== operation || error.name === 'AbortError') return;
    const failure = error instanceof ApiError ? error : new ApiError('connection_failed');
    emptyState(failure.message);
    setStatus(failure.needsLogin ? 'Login needed' : 'Unavailable');
    if (failure.needsLogin || save) {
      if (!$('login-dialog').open) openLogin();
      $('login-error').textContent = failure.message;
      $('login-error').hidden = false;
    }
  } finally {
    if (currentOperation === operation) {
      controller = null;
      $('refresh-button').disabled = false;
      $('import-button').disabled = false;
      $('import-button').textContent = 'Save login';
    }
  }
}

$('connect-button').addEventListener('click', openLogin);
$('refresh-button').addEventListener('click', () => loadBarcode());
$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  $('login-error').hidden = true;
  try { loadBarcode(extractToken($('token-input').value, settings.schoolId), true); }
  catch {
    $('login-error').textContent = 'Paste a Fusion token or the completed SSO URL for this institution.';
    $('login-error').hidden = false;
  }
});
$('login-dialog').addEventListener('close', () => { $('token-input').value = ''; });
$('login-dialog').addEventListener('cancel', () => {
  if (controller) { cancelRequest(); emptyState(); setStatus('Not ready'); }
});
$('token-file-button').addEventListener('click', () => $('token-file').click());
$('token-file').addEventListener('change', async () => {
  const file = $('token-file').files?.[0];
  if (!file) return;
  try {
    if (file.size > 32768) throw new Error('Too large');
    const data = JSON.parse(await file.text());
    if (data.school_id !== settings.schoolId) throw new Error('Different institution');
    await loadBarcode(extractToken(data.token, settings.schoolId), true);
  } catch {
    $('login-error').textContent = 'Choose the Python token JSON file for the selected institution.';
    $('login-error').hidden = false;
  } finally { $('token-file').value = ''; }
});
$('settings-button').addEventListener('click', () => {
  $('school-input').value = settings.schoolId;
  $('name-input').value = settings.name;
  $('settings-error').hidden = true;
  showDialog('settings-dialog');
});
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const schoolId = validateSchoolId($('school-input').value.trim());
    settings = { schoolId, name: $('name-input').value.trim().slice(0, 60) };
    saveSettings(storage, settings);
    cancelRequest();
    clearBarcode();
    updateInstitution();
    $('settings-dialog').close();
    loadBarcode();
  } catch {
    $('settings-error').textContent = 'Use a numeric institution ID of one to six digits.';
    $('settings-error').hidden = false;
  }
});
$('renew-button').addEventListener('click', () => { $('settings-dialog').close(); openLogin(); });
$('forget-button').addEventListener('click', () => {
  cancelRequest();
  const removed = vault.forget(settings.schoolId);
  $('settings-dialog').close();
  emptyState();
  setStatus('Not connected');
  notice(removed ? 'Saved login removed for this institution.' : 'Could not remove the saved login from storage. Clear this website’s data in your browser settings.');
});
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => {
    if (button.dataset.close === 'login-dialog' && controller) {
      cancelRequest(); emptyState(); setStatus('Not connected');
    }
    $(button.dataset.close).close();
  });
}

$('scan-button').addEventListener('click', () => {
  if (!barcode) return;
  $('scan-institution').textContent = institutionName();
  $('scan-barcode').innerHTML = barcodeSvg(barcode);
  showDialog('scan-dialog');
  keepScreenAwake();
});
$('download-button').addEventListener('click', () => {
  if (!barcode) return;
  const institution = settings.schoolId;
  const geometry = barcodeGeometry(barcode);
  const canvas = document.createElement('canvas');
  canvas.width = geometry.width; canvas.height = geometry.height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  for (const bar of geometry.bars) context.fillRect(bar.x, 10, bar.width, geometry.barHeight);
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `barcode-${institution}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }, 'image/png');
});

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('appinstalled', () => { $('install-button').hidden = true; installPrompt = null; });
$('install-button').hidden = matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone);
$('install-button').addEventListener('click', async () => {
  if (installPrompt) { await installPrompt.prompt(); installPrompt = null; }
  else $('install-help').hidden = false;
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { releaseWakeLock(); return; }
  if (!$('login-dialog').open && !$('settings-dialog').open && !$('scan-dialog').open &&
      !controller && vault.get(settings.schoolId) && Date.now() - lastAttempt > 15000) loadBarcode();
  else keepScreenAwake();
});
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* Install support is optional. */ });
}
updateInstitution();
loadBarcode();
