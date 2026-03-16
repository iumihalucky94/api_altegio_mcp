import type { DbPool } from '../db';
import type { DecisionObject } from '../types/contracts';
export interface DecisionSnapshotOptions {
    maxTextLength?: number;
}
export declare function persistDecisionSnapshot(db: DbPool, conversationId: string, decision: DecisionObject, options?: DecisionSnapshotOptions): Promise<void>;
//# sourceMappingURL=decisionDiagnostics.d.ts.map