"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAudit = logAudit;
const SECRET_KEYS = new Set([
    'token',
    'secret',
    'password',
    'authorization',
    'bearer',
    'access_token',
    'refresh_token',
    'api_key',
    'cookie',
    'set-cookie',
    'app_secret'
]);
function scrub(obj) {
    if (obj === null || obj === undefined)
        return obj;
    if (Array.isArray(obj))
        return obj.map((v) => scrub(v));
    if (typeof obj === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            const lower = k.toLowerCase();
            if (SECRET_KEYS.has(lower)) {
                out[k] = '[redacted]';
            }
            else if (k === 'webhook_payload' || k === 'raw_payload' || k === 'request_body') {
                out[k] = '[payload_omitted]';
            }
            else {
                out[k] = scrub(v);
            }
        }
        return out;
    }
    return obj;
}
function shallowDiff(before, after) {
    const b = (before && typeof before === 'object' ? before : {});
    const a = (after && typeof after === 'object' ? after : {});
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const diff = {};
    for (const k of keys) {
        const bv = b[k];
        const av = a[k];
        if (JSON.stringify(bv) !== JSON.stringify(av)) {
            diff[k] = { before: bv, after: av };
        }
    }
    return diff;
}
async function logAudit(db, params) {
    const beforeScrubbed = scrub(params.before);
    const afterScrubbed = scrub(params.after);
    const diff = shallowDiff(beforeScrubbed, afterScrubbed);
    await db.query(`INSERT INTO audit_log
     (actor_type, actor_id, source, action, entity_table, entity_id, before_json, after_json, diff_json,
      correlation_id, request_id, conversation_id, client_phone, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
        params.actor.actor_type,
        params.actor.actor_id,
        params.source,
        params.action,
        params.entity_table,
        params.entity_id ?? null,
        beforeScrubbed ?? null,
        afterScrubbed ?? null,
        Object.keys(diff).length ? diff : null,
        params.correlation_id ?? null,
        params.request_id ?? null,
        params.conversation_id ?? null,
        params.client_phone ?? null,
        scrub(params.metadata ?? null) ?? null
    ]);
}
//# sourceMappingURL=audit.js.map