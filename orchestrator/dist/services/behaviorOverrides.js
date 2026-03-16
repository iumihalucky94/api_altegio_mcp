"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBehaviorOverride = getBehaviorOverride;
exports.setRule = setRule;
const audit_1 = require("./audit");
async function getBehaviorOverride(db, phone) {
    const res = await db.query(`SELECT phone, language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics,
            updated_at::text, updated_by FROM client_behavior_overrides WHERE phone = $1`, [phone]);
    return res.rows[0] ?? null;
}
async function setRule(db, phone, key, value, by = 'admin') {
    const col = key;
    if (col === 'language_preference' || col === 'tone_profile' || col === 'notes_for_agent') {
        const beforeRes = await db.query(`SELECT phone, language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics
       FROM client_behavior_overrides WHERE phone = $1`, [phone]);
        const before = beforeRes.rows[0] ?? null;
        await db.query(`INSERT INTO client_behavior_overrides (phone, ${col}, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (phone) DO UPDATE SET ${col} = $2, updated_at = now(), updated_by = $3`, [phone, value, by]);
        const afterRes = await db.query(`SELECT phone, language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics
       FROM client_behavior_overrides WHERE phone = $1`, [phone]);
        const after = afterRes.rows[0] ?? null;
        await (0, audit_1.logAudit)(db, {
            actor: { actor_type: 'admin', actor_id: by },
            source: 'behavior_overrides',
            action: 'behavior.override.update',
            entity_table: 'client_behavior_overrides',
            entity_id: phone,
            before,
            after,
            client_phone: phone
        });
    }
    else if (col === 'force_handoff') {
        const b = value === true || value === 'true' || value === '1';
        const beforeRes = await db.query(`SELECT phone, language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics
       FROM client_behavior_overrides WHERE phone = $1`, [phone]);
        const before = beforeRes.rows[0] ?? null;
        await db.query(`INSERT INTO client_behavior_overrides (phone, force_handoff, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (phone) DO UPDATE SET force_handoff = $2, updated_at = now(), updated_by = $3`, [phone, b, by]);
        const afterRes = await db.query(`SELECT phone, language_preference, tone_profile, force_handoff, notes_for_agent, blocked_topics
       FROM client_behavior_overrides WHERE phone = $1`, [phone]);
        const after = afterRes.rows[0] ?? null;
        await (0, audit_1.logAudit)(db, {
            actor: { actor_type: 'admin', actor_id: by },
            source: 'behavior_overrides',
            action: 'behavior.override.update',
            entity_table: 'client_behavior_overrides',
            entity_id: phone,
            before,
            after,
            client_phone: phone
        });
    }
}
//# sourceMappingURL=behaviorOverrides.js.map