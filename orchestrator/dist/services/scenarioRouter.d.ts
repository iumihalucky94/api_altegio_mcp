import type { ScenarioRouterResult } from '../types/contracts';
import type { LanguageCode } from './intent';
import type { ResolvedLanguage } from './localization';
export interface ScenarioRouterInput {
    text: string;
    languageHint: string | null;
    languagePreference: string | null;
}
export interface ScenarioRouterOutput extends ScenarioRouterResult {
    languageCode: LanguageCode;
    effectiveLanguage: ResolvedLanguage;
}
export declare function routeScenario(input: ScenarioRouterInput): ScenarioRouterOutput;
//# sourceMappingURL=scenarioRouter.d.ts.map