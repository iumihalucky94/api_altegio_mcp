"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKbContext = getKbContext;
exports.buildKbContextBlock = buildKbContextBlock;
async function getKbContext(db, input) {
    const { intent, language, phone, limits } = input;
    // Policies: global + phone-scoped, ordered by priority desc, phone-specific first.
    const policiesRes = await db.query(`SELECT key, scope, phone, value_json, priority, is_enabled, description, updated_at, updated_by
     FROM agent_policies
     WHERE is_enabled = TRUE
       AND (
         scope = 'global'
         OR (scope = 'phone' AND phone = $1)
       )
     ORDER BY
       CASE WHEN scope = 'phone' AND phone = $1 THEN 0 ELSE 1 END,
       priority DESC`, [phone ?? null]);
    // Playbooks: filter by enabled and tag/keyword match on intent.
    const playbooksRes = await db.query(`SELECT id, scenario_key, language, instruction, priority, is_enabled, tags, updated_at, updated_by
     FROM agent_playbooks
     WHERE is_enabled = TRUE
       AND (
         scenario_key = $1
         OR scenario_key LIKE $2
         OR (tags IS NOT NULL AND tags @> $3::jsonb)
       )
     ORDER BY priority DESC, updated_at DESC
     LIMIT 5`, [intent, `${intent}_%`, JSON.stringify([intent])]);
    // Templates: top N by weight for intent+language.
    const templatesRes = await db.query(`SELECT id, name, intent, language, body, tags, is_enabled, weight, updated_at, updated_by
     FROM agent_templates
     WHERE is_enabled = TRUE
       AND intent = $1
       AND language = $2
     ORDER BY weight DESC, updated_at DESC
     LIMIT $3`, [intent, language, limits.templates]);
    // Examples GOOD
    const goodRes = await db.query(`SELECT id, intent, language, label, client_text, agent_text, explanation, tags, weight, is_enabled, created_at, updated_at, updated_by
     FROM agent_examples
     WHERE is_enabled = TRUE
       AND intent = $1
       AND (language = $2 OR language = 'mixed')
       AND label = 'GOOD'
     ORDER BY weight DESC, created_at DESC
     LIMIT $3`, [intent, language, limits.goodExamples]);
    // Examples BAD
    const badRes = await db.query(`SELECT id, intent, language, label, client_text, agent_text, explanation, tags, weight, is_enabled, created_at, updated_at, updated_by
     FROM agent_examples
     WHERE is_enabled = TRUE
       AND intent = $1
       AND (language = $2 OR language = 'mixed')
       AND label = 'BAD'
     ORDER BY weight DESC, created_at DESC
     LIMIT $3`, [intent, language, limits.badExamples]);
    return {
        policies: policiesRes.rows,
        playbooks: playbooksRes.rows,
        templates: templatesRes.rows,
        examples_good: goodRes.rows,
        examples_bad: badRes.rows
    };
}
function buildKbContextBlock(kb, maxChars) {
    const lines = [];
    lines.push('KB_CONTEXT:');
    // Policies (authoritative)
    if (kb.policies.length) {
        lines.push('POLICIES (authoritative):');
        const maxPolicies = 10;
        for (const p of kb.policies.slice(0, maxPolicies)) {
            const v = p.value_json;
            let valueStr;
            if (v === null || v === undefined)
                valueStr = 'null';
            else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                valueStr = String(v);
            }
            else {
                valueStr = JSON.stringify(v);
            }
            const scopeLabel = p.scope === 'phone' && p.phone ? ` [phone=${p.phone}]` : '';
            lines.push(`- ${p.key}=${valueStr}${scopeLabel}`);
        }
    }
    // Sanitizer flags
    const cancelNeedsApproval = kb.policies.some((p) => p.key === 'cancellation.always_approval' &&
        (p.value_json === true || String(p.value_json).toLowerCase() === 'true'));
    const conflictMarkers = ['stornier', 'cancel', 'отмен'];
    function isConflictingText(text) {
        if (!text)
            return false;
        const t = text.toLowerCase();
        return conflictMarkers.some((m) => t.includes(m));
    }
    let conflictDropped = false;
    // Playbooks
    const playbooks = kb.playbooks.slice(0, 2);
    if (playbooks.length) {
        lines.push('PLAYBOOKS:');
        for (const pb of playbooks) {
            lines.push(`- ${pb.scenario_key}:`);
            const instr = String(pb.instruction || '');
            const instrLines = instr.split('\n').filter((l) => l.trim().length > 0);
            for (const l of instrLines.slice(0, 8)) {
                lines.push(`  ${l}`);
            }
        }
    }
    // Templates (style reference)
    let templates = kb.templates.slice(0, 2);
    if (cancelNeedsApproval) {
        templates = templates.filter((t) => {
            const bad = isConflictingText(t.body);
            if (bad)
                conflictDropped = true;
            return !bad;
        });
    }
    if (templates.length) {
        lines.push('TEMPLATES (style reference, do NOT override policies):');
        for (const t of templates) {
            lines.push(`- ${t.body}`);
        }
    }
    // Examples GOOD
    let good = kb.examples_good.slice(0, 2);
    if (cancelNeedsApproval) {
        good = good.filter((e) => {
            const bad = isConflictingText(e.agent_text);
            if (bad)
                conflictDropped = true;
            return !bad;
        });
    }
    if (good.length) {
        lines.push('EXAMPLES GOOD (style reference):');
        for (const e of good) {
            lines.push(`- Client: ${e.client_text}`);
            lines.push(`  Reply: ${e.agent_text}`);
        }
    }
    // Examples BAD
    let bad = kb.examples_bad.slice(0, 1);
    if (cancelNeedsApproval) {
        bad = bad.filter((e) => {
            const badText = isConflictingText(e.agent_text);
            if (badText)
                conflictDropped = true;
            return !badText;
        });
    }
    if (bad.length) {
        lines.push('EXAMPLES BAD (avoid):');
        for (const e of bad) {
            lines.push(`- Client: ${e.client_text}`);
            lines.push(`  Reply: ${e.agent_text}`);
        }
    }
    if (conflictDropped) {
        lines.push('NOTE: some KB items were dropped due to policy conflict (kb_conflict_dropped).');
    }
    let text = lines.join('\n');
    if (maxChars > 0 && text.length > maxChars) {
        text = text.slice(0, maxChars);
        const idx = text.lastIndexOf('\n');
        if (idx > 0) {
            text = text.slice(0, idx);
        }
        text += '\n[KB_CONTEXT truncated]\n';
    }
    return text;
}
//# sourceMappingURL=kb.js.map