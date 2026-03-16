import type { ClientContext } from '../types/contracts';
import type { ResolvedLanguage } from './localization';
import type { BehaviorOverride } from './behaviorOverrides';
import type { ConversationRow } from './conversation';
export interface BuildClientContextParams {
    phoneE164: string;
    conversation: ConversationRow;
    lastMessages: Array<{
        ts: string;
        direction: string;
        author: string;
        text: string;
    }>;
    behaviorOverride: BehaviorOverride | null;
    detectedLanguage: ResolvedLanguage;
    languageHint: string | null;
    kbContextSummary?: string;
    upcomingAppointments?: Array<{
        id?: string;
        start?: string;
        service?: string;
        master?: string;
    }>;
}
export declare function buildClientContext(params: BuildClientContextParams): ClientContext;
//# sourceMappingURL=clientContext.d.ts.map