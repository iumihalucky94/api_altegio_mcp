import type { ScenarioRouterResult, ScenarioCode } from '../types/contracts';
import type { LanguageCode } from './intent';
import { classifyIntent, detectLanguage } from './intent';
import { intentToScenarioCode } from './scenarioPolicy';
import type { ResolvedLanguage } from './localization';
import { resolveReplyLanguage } from './localization';

export interface ScenarioRouterInput {
  text: string;
  languageHint: string | null;
  languagePreference: string | null;
}

export interface ScenarioRouterOutput extends ScenarioRouterResult {
  languageCode: LanguageCode;
  effectiveLanguage: ResolvedLanguage;
}

export function routeScenario(input: ScenarioRouterInput): ScenarioRouterOutput {
  const { text, languageHint, languagePreference } = input;

  const intent = classifyIntent(text);
  const languageCode = detectLanguage(text, languageHint);
  const scenarioCode = intentToScenarioCode(intent) as ScenarioCode;
  const effectiveLanguage = resolveReplyLanguage(text, languageHint, languagePreference);

  const result: ScenarioRouterOutput = {
    intent,
    scenarioCode,
    confidence: 1.0,
    languageCode,
    effectiveLanguage
  };

  return result;
}

