import type { DbPool } from '../db';
export interface KbContext {
    policies: any[];
    playbooks: any[];
    templates: any[];
    examples_good: any[];
    examples_bad: any[];
}
export interface KbQueryInput {
    intent: string;
    language: string;
    phone?: string | null;
    messageText?: string;
    limits: {
        templates: number;
        goodExamples: number;
        badExamples: number;
    };
}
export declare function getKbContext(db: DbPool, input: KbQueryInput): Promise<KbContext>;
export declare function buildKbContextBlock(kb: KbContext, maxChars: number): string;
//# sourceMappingURL=kb.d.ts.map