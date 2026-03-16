import type { ScenarioRouterResult, ClientContext, PolicyResult, DecisionObject, BookingSpecialistResult, RescheduleSpecialistResult, CancellationSpecialistResult } from '../types/contracts';
import type { ResolvedLanguage } from './localization';
export interface DecisionAssemblerInput {
    scenario: ScenarioRouterResult;
    context: ClientContext;
    policy: PolicyResult;
    fallbackLanguage: ResolvedLanguage;
    bookingResult?: BookingSpecialistResult;
    rescheduleResult?: RescheduleSpecialistResult;
    cancellationResult?: CancellationSpecialistResult;
}
export declare function assembleDecisionSkeleton(input: DecisionAssemblerInput): DecisionObject;
//# sourceMappingURL=decisionAssembler.d.ts.map