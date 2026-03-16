import type { LanguageCode } from './intent';
/** Resolved language for reply (no 'mixed'); used for getSystemMessage. */
export type ResolvedLanguage = 'de' | 'ru' | 'en';
/**
 * Resolve effective reply language when detectLanguage returns 'mixed'.
 * Order: (1) language_preference (client_behavior_overrides), (2) conversation.language_hint,
 * (3) heuristics from latest message text, (4) default 'de'.
 */
export declare function resolveReplyLanguage(batchText: string, languageHint?: string | null, languagePreference?: string | null): ResolvedLanguage;
/**
 * Get effective language for localization: if lang is 'mixed', resolve via resolveReplyLanguage;
 * otherwise use lang (must be de|ru|en for lookup).
 */
export declare function effectiveLangForReply(lang: LanguageCode, batchText: string, languageHint?: string | null, languagePreference?: string | null): ResolvedLanguage;
/**
 * Returns system message by key and language. Optional vars for template substitution (e.g. { n: 3 } for {{n}}).
 */
export declare function getSystemMessage(key: string, lang: ResolvedLanguage, vars?: Record<string, string | number>): string;
//# sourceMappingURL=localization.d.ts.map