import { validateSchoolId, validateToken } from './response.js';

const SETTINGS_KEY = 'my-barcode.settings.v1';
const TOKEN_PREFIX = 'my-barcode.token.v1.';
export const DEFAULT_SETTINGS = { schoolId: '107', name: 'Texas A&M' };

export function readSettings(storage) {
  try {
    const value = JSON.parse(storage?.getItem(SETTINGS_KEY));
    validateSchoolId(value.schoolId);
    return { schoolId: value.schoolId, name: typeof value.name === 'string' ? value.name.slice(0, 60) : '' };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(storage, settings) {
  validateSchoolId(settings.schoolId);
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); return Boolean(storage); } catch { return false; }
}

export class TokenVault {
  constructor(storage) { this.storage = storage; this.memory = new Map(); }

  get(schoolId) {
    validateSchoolId(schoolId);
    if (this.memory.has(schoolId)) return this.memory.get(schoolId);
    try {
      const record = JSON.parse(this.storage?.getItem(TOKEN_PREFIX + schoolId));
      if (record.schoolId !== schoolId) return null;
      validateToken(record.token);
      return { token: record.token, persistent: true };
    } catch { return null; }
  }

  put(schoolId, token) {
    validateSchoolId(schoolId); validateToken(token);
    let persistent = false;
    try {
      this.storage?.setItem(TOKEN_PREFIX + schoolId, JSON.stringify({ schoolId, token, savedAt: new Date().toISOString() }));
      persistent = Boolean(this.storage);
    } catch { /* Storage-blocked browsers can still use the current session. */ }
    this.memory.set(schoolId, { token, persistent });
    return persistent;
  }

  forget(schoolId) {
    validateSchoolId(schoolId);
    let removed = false;
    try { this.storage?.removeItem(TOKEN_PREFIX + schoolId); removed = Boolean(this.storage); } catch { /* Report failure to the UI. */ }
    this.memory.set(schoolId, null);
    return removed || !this.storage;
  }
}
