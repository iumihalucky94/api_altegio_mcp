"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeScenario = routeScenario;
const intent_1 = require("./intent");
const scenarioPolicy_1 = require("./scenarioPolicy");
const localization_1 = require("./localization");
function routeScenario(input) {
    const { text, languageHint, languagePreference } = input;
    const intent = (0, intent_1.classifyIntent)(text);
    const languageCode = (0, intent_1.detectLanguage)(text, languageHint);
    const scenarioCode = (0, scenarioPolicy_1.intentToScenarioCode)(intent);
    const effectiveLanguage = (0, localization_1.resolveReplyLanguage)(text, languageHint, languagePreference);
    const result = {
        intent,
        scenarioCode,
        confidence: 1.0,
        languageCode,
        effectiveLanguage
    };
    return result;
}
//# sourceMappingURL=scenarioRouter.js.map