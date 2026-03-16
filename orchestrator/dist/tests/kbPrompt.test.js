"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const kb_1 = require("../services/kb");
async function main() {
    const kb = {
        policies: [
            {
                key: 'cancellation.always_approval',
                scope: 'global',
                phone: null,
                value_json: true,
                priority: 200
            }
        ],
        playbooks: [
            {
                scenario_key: 'late_15_plus',
                language: 'de',
                instruction: '- Kunde >=15 Minuten zu spät.\n- Immer HANDOFF.',
                priority: 150
            }
        ],
        templates: [
            {
                id: 't1',
                body: 'Ich storniere Ihren Termin jetzt ohne Rückfrage.',
                weight: 1.0
            },
            {
                id: 't2',
                body: 'Wir prüfen die Stornierung mit dem Team und melden uns mit einer Bestätigung.',
                weight: 2.0
            }
        ],
        examples_good: [
            {
                id: 'e1',
                client_text: 'Ich möchte morgen absagen.',
                agent_text: 'Gerne, ich leite Ihre Anfrage zur Bestätigung an unser Team weiter.',
                weight: 1.0
            }
        ],
        examples_bad: [
            {
                id: 'e2',
                client_text: 'Ich möchte morgen absagen.',
                agent_text: 'Kein Problem, ich storniere sofort ohne Rückfrage.',
                weight: 1.0
            }
        ]
    };
    const text = (0, kb_1.buildKbContextBlock)(kb, 200);
    if (!text.includes('KB_CONTEXT:')) {
        console.error('KB block must start with KB_CONTEXT header');
        process.exit(1);
    }
    if (!text.includes('POLICIES (authoritative):')) {
        console.error('KB block must contain POLICIES section');
        process.exit(1);
    }
    if (text.includes('Ich storniere Ihren Termin jetzt ohne Rückfrage')) {
        console.error('Conflicting template was not removed by sanitizer');
        process.exit(1);
    }
    if (text.includes('Kein Problem, ich storniere sofort ohne Rückfrage')) {
        console.error('Conflicting BAD example was not removed by sanitizer');
        process.exit(1);
    }
    if (!text.includes('kb_conflict_dropped')) {
        console.error('Conflict marker kb_conflict_dropped not present');
        process.exit(1);
    }
    if (text.length > 200) {
        console.error('KB_CONTEXT_MAX_CHARS limit not respected', text.length);
        process.exit(1);
    }
    console.log('KB prompt builder tests passed');
    process.exit(0);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=kbPrompt.test.js.map