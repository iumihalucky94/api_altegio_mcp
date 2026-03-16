import type { ResolvedLanguage } from './localization';
import type { ScenarioCode } from '../types/contracts';
export interface ReplyQaGuardInput {
    scenarioCode: ScenarioCode;
    language: ResolvedLanguage;
    text: string;
    writerUsedFallback: boolean;
    allowAgentToReply: boolean;
    bookingToolSucceeded?: boolean;
    replyLooksConfirmed?: boolean;
}
export interface ReplyQaIssue {
    code: 'language_mismatch' | 'forbidden_phrase' | 'unsafe_confirmation' | 'empty_or_weak';
    message: string;
}
export interface ReplyQaGuardResult {
    approved: boolean;
    fallbackUsed: boolean;
    finalText: string;
    issues: ReplyQaIssue[];
}
export declare function runReplyQaGuard(input: ReplyQaGuardInput): ReplyQaGuardResult;
//# sourceMappingURL=replyQaGuard.d.ts.map