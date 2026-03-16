"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initConfig = initConfig;
exports.getConfig = getConfig;
exports.getConfigString = getConfigString;
exports.getConfigNumber = getConfigNumber;
exports.getConfigBoolean = getConfigBoolean;
let dbRef = null;
const envDefaults = new Map();
const cache = new Map();
const CACHE_TTL_MS = 15000;
function initConfig(db, defaults) {
    dbRef = db;
    Object.entries(defaults).forEach(([k, v]) => envDefaults.set(k, v));
}
async function loadFromDb(key) {
    if (!dbRef)
        return undefined;
    const res = await dbRef.query('SELECT value_json FROM admin_config WHERE key = $1', [key]);
    if (res.rows.length === 0)
        return undefined;
    const v = res.rows[0].value_json;
    if (typeof v === 'string' && v.startsWith('"'))
        return JSON.parse(v);
    return v;
}
async function getConfig(key) {
    const now = Date.now();
    const entry = cache.get(key);
    if (entry && entry.expiresAt > now)
        return entry.value;
    const dbVal = await loadFromDb(key);
    const envVal = envDefaults.get(key);
    const out = (dbVal ?? envVal);
    cache.set(key, { value: out, expiresAt: now + CACHE_TTL_MS });
    return out;
}
async function getConfigString(key, fallback) {
    const v = await getConfig(key);
    if (v === undefined || v === null)
        return fallback;
    return String(v);
}
async function getConfigNumber(key, fallback) {
    const v = await getConfig(key);
    if (v === undefined || v === null)
        return fallback;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) ? n : fallback;
}
async function getConfigBoolean(key, fallback) {
    const v = await getConfig(key);
    if (v === undefined || v === null)
        return fallback;
    if (typeof v === 'boolean')
        return v;
    const s = String(v).toLowerCase();
    return s === 'true' || s === '1';
}
//# sourceMappingURL=config.js.map