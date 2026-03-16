export type Intent = 'BOOKING' | 'RESCHEDULE' | 'CANCEL_REQUEST' | 'LATE_NOTICE' | 'POLICY_QUESTION' | 'COMPLAINT_OR_EMOTIONAL' | 'SERVICE_NOT_PROVIDED' | 'UNKNOWN';
export type LanguageCode = 'de' | 'ru' | 'en' | 'mixed';
export declare function classifyIntent(text: string): Intent;
export declare function detectLanguage(text: string, override?: string | null): LanguageCode;
//# sourceMappingURL=intent.d.ts.map