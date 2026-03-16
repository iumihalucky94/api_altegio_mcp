import type { ScenarioCode } from '../types/contracts';
import type { HandoffPreparationResult } from '../types/contracts';
import type { HandoffReasonCode } from '../types/reasonCodes';
export interface HandoffSpecialistInput {
    scenarioCode: ScenarioCode;
    reasonCode: HandoffReasonCode;
    confidence?: number;
    summary: string;
    replyPreview?: string;
    tags?: string[];
}
export declare function prepareHandoff(input: HandoffSpecialistInput): HandoffPreparationResult;
//# sourceMappingURL=handoffSpecialist.d.ts.map