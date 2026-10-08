import { validateBarcode } from './barcode.js';

export class ApiError extends Error {
  constructor(code) {
    const messages = {
      authentication_required: 'Your login needs renewing. Sign in and import a fresh token.',
      invalid_response: 'The service did not return a valid barcode. Try again or renew your login.',
      service_unavailable: 'The barcode service is unavailable. Your saved login has been kept.',
      rate_limited: 'Too many requests. Wait a moment before trying again.',
      connection_failed: 'Could not connect. Check your internet connection and that the app’s server is running.',
      relay_connection_failed: 'Could not reach this website’s barcode relay. Check your connection and that the Node server is running.',
      relay_unavailable: 'This website has no working barcode relay. Run npm start and open http://127.0.0.1:4173, or deploy the included Node server.',
      timeout: 'The request timed out. Your saved login has been kept.',
      invalid_input: 'Check your institution ID and token.',
    };
    const safeCode = Object.hasOwn(messages, code) ? code : 'service_unavailable';
    super(messages[safeCode]);
    this.code = safeCode;
    this.needsLogin = safeCode === 'authentication_required' || safeCode === 'invalid_response';
  }
}

export function validateSchoolId(value) {
  if (typeof value !== 'string' || !/^[0-9]{1,6}$/.test(value)) throw new ApiError('invalid_input');
  return value;
}

export function validateToken(value) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(value)) throw new ApiError('invalid_input');
  return value;
}

export function extractToken(input, institution) {
  const value = String(input).trim();
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw new ApiError('invalid_input'); }
    if (url.origin !== 'https://innosoftfusiongo.com' || url.username || url.password || !url.pathname.startsWith('/sso/login/')) {
      throw new ApiError('invalid_input');
    }
    const tokens = url.searchParams.getAll('fusiontoken');
    const school = url.searchParams.get('id');
    if (tokens.length !== 1 || (school && school !== institution)) throw new ApiError('invalid_input');
    return validateToken(tokens[0]);
  }
  return validateToken(value);
}

export function loginUrl(institution) {
  return `https://innosoftfusiongo.com/sso/login/login-start.php?id=${validateSchoolId(institution)}`;
}

export function parseUpstream(status, text) {
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  const message = data && !Array.isArray(data) ? String(data.message || data.error || '') : '';
  if (status === 429) throw new ApiError('rate_limited');
  if (status === 408 || status >= 500 || (status >= 300 && status < 400) ||
      /could not reach|connection refused|connection timed out|could not resolve/i.test(message)) {
    throw new ApiError('service_unavailable');
  }
  if (status < 200 || status >= 300) {
    throw new ApiError([400, 401, 403].includes(status) ? 'authentication_required' : 'service_unavailable');
  }
  const record = Array.isArray(data) ? data[0] : data;
  let value = record?.AppBarcodeIdNumber;
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  try { return validateBarcode(value); } catch { throw new ApiError('invalid_response'); }
}

export async function boundedText(response, maxBytes = 1024 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError('service_unavailable');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
