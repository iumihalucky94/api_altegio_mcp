"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const kb_1 = require("../services/kb");
class FakeDb {
    constructor() {
        this.tables = {};
    }
    add(table, row) {
        if (!this.tables[table])
            this.tables[table] = [];
        this.tables[table].push(row);
    }
    async query(sql, params) {
        if (sql.includes('FROM agent_templates')) {
            const intent = params[0];
            const language = params[1];
            const limit = params[2];
            const rows = (this.tables.agent_templates || [])
                .filter((r) => r.intent === intent && r.language === language && r.is_enabled !== false)
                .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
                .slice(0, limit);
            return { rows };
        }
        if (sql.includes('FROM agent_examples') && sql.includes('label = \'GOOD\'')) {
            const intent = params[0];
            const language = params[1];
            const limit = params[2];
            const rows = (this.tables.agent_examples || [])
                .filter((r) => r.intent === intent &&
                (r.language === language || r.language === 'mixed') &&
                r.label === 'GOOD' &&
                r.is_enabled !== false)
                .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
                .slice(0, limit);
            return { rows };
        }
        if (sql.includes('FROM agent_examples') && sql.includes('label = \'BAD\'')) {
            const intent = params[0];
            const language = params[1];
            const limit = params[2];
            const rows = (this.tables.agent_examples || [])
                .filter((r) => r.intent === intent &&
                (r.language === language || r.language === 'mixed') &&
                r.label === 'BAD' &&
                r.is_enabled !== false)
                .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
                .slice(0, limit);
            return { rows };
        }
        if (sql.includes('FROM agent_policies')) {
            // For this smoke test we don't depend on exact ordering implementation.
            return { rows: this.tables.agent_policies || [] };
        }
        if (sql.includes('FROM agent_playbooks')) {
            return { rows: this.tables.agent_playbooks || [] };
        }
        return { rows: [] };
    }
}
async function main() {
    const db = new FakeDb();
    // Templates with different weights
    db.add('agent_templates', {
        id: 't1',
        name: 'low',
        intent: 'BOOKING',
        language: 'de',
        body: 'low',
        is_enabled: true,
        weight: 0.5
    });
    db.add('agent_templates', {
        id: 't2',
        name: 'high',
        intent: 'BOOKING',
        language: 'de',
        body: 'high',
        is_enabled: true,
        weight: 2.0
    });
    // Examples GOOD/BAD with different weights
    db.add('agent_examples', {
        id: 'e1',
        intent: 'BOOKING',
        language: 'de',
        label: 'GOOD',
        client_text: 'c1',
        agent_text: 'a1',
        weight: 1.0,
        is_enabled: true
    });
    db.add('agent_examples', {
        id: 'e2',
        intent: 'BOOKING',
        language: 'de',
        label: 'GOOD',
        client_text: 'c2',
        agent_text: 'a2',
        weight: 2.0,
        is_enabled: true
    });
    db.add('agent_examples', {
        id: 'e3',
        intent: 'BOOKING',
        language: 'de',
        label: 'BAD',
        client_text: 'c3',
        agent_text: 'a3',
        weight: 3.0,
        is_enabled: true
    });
    const ctx = await (0, kb_1.getKbContext)(db, {
        intent: 'BOOKING',
        language: 'de',
        phone: null,
        messageText: 'test',
        limits: { templates: 1, goodExamples: 2, badExamples: 1 }
    });
    if (ctx.templates.length !== 1 || ctx.templates[0].name !== 'high') {
        console.error('KB templates ordering test failed', ctx.templates);
        process.exit(1);
    }
    if (ctx.examples_good.length !== 2 || ctx.examples_good[0].id !== 'e2') {
        console.error('KB examples GOOD ordering test failed', ctx.examples_good);
        process.exit(1);
    }
    if (ctx.examples_bad.length !== 1 || ctx.examples_bad[0].id !== 'e3') {
        console.error('KB examples BAD ordering/limit test failed', ctx.examples_bad);
        process.exit(1);
    }
    console.log('KB retrieval ordering tests passed');
    process.exit(0);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=kbRetrieval.test.js.map