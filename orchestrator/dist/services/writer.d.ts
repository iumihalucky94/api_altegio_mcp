import type { ResolvedLanguage } from './localization';
import type { ScenarioCode } from '../types/contracts';
export interface WriterInput {
    scenarioCode: ScenarioCode;
    language: ResolvedLanguage;
    replyCandidate: string | null;
    allowAgentToReply: boolean;
}
export interface WriterOutput {
    text: string;
    usedFallback: boolean;
}
export declare function writeReply(input: WriterInput): WriterOutput;
//# sourceMappingURL=writer.d.ts.map