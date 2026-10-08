import { ApiError, validateSchoolId, validateToken, boundedText } from './response.js';
import { validateBarcode } from './barcode.js';

export class BarcodeApi {
  constructor({ fetchImpl = globalThis.fetch.bind(globalThis), baseUrl = globalThis.location?.href || 'http://localhost/' } = {}) {
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async get(schoolId, token, signal) {
    validateSchoolId(schoolId); validateToken(token);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    try {
      controller.signal.throwIfAborted();
      const response = await this.fetch(new URL('./api/barcode', this.baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId }),
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      const text = await boundedText(response);
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      if ([404, 405, 501].includes(response.status) || (response.ok && !data && /^\s*</.test(text))) {
        throw new ApiError('relay_unavailable');
      }
      if (!response.ok) {
        if (typeof data?.error === 'string') throw new ApiError(data.error);
        // A reverse proxy may return HTML during an outage. That is not evidence
        // that the user's Fusion token needs replacing.
        throw new ApiError(response.status === 429 ? 'rate_limited' :
          [401, 403].includes(response.status) ? 'authentication_required' : 'service_unavailable');
      }
      try { validateBarcode(data.barcode); } catch { throw new ApiError('invalid_response'); }
      if (data.schoolId !== schoolId) throw new ApiError('invalid_response');
      return { barcode: data.barcode, fetchedAt: new Date().toISOString() };
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (error instanceof ApiError) throw error;
      throw new ApiError(timedOut ? 'timeout' : 'relay_connection_failed');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
}
