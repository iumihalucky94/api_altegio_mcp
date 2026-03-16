import type {
  ScenarioRouterResult,
  ClientContext,
  PolicyResult,
  DecisionObject,
  ActionPlan,
  DecisionOutcome,
  BookingSpecialistResult
} from '../types/contracts';
import type { ResolvedLanguage } from './localization';

export interface DecisionAssemblerInput {
  scenario: ScenarioRouterResult;
  context: ClientContext;
  policy: PolicyResult;
  fallbackLanguage: ResolvedLanguage;
  bookingResult?: BookingSpecialistResult;
}

// Skeleton assembler: creates a minimal DecisionObject without changing behaviour.
export function assembleDecisionSkeleton(input: DecisionAssemblerInput): DecisionObject {
  const { scenario, context, policy, fallbackLanguage, bookingResult } = input;

  const actionPlan: ActionPlan = {
    reply: {
      text: null,
      language: fallbackLanguage
    },
    execution: {
      mcpCalls: []
    },
    handoff: null
  };

  const outcome: DecisionOutcome = {
    type: 'SKIP',
    reasonCode: 'unknown',
    confidence: scenario.confidence
  };

  return {
    scenario,
    context,
    policy,
    schedule: undefined,
    bookingResult,
    rescheduleResult: undefined,
    cancellationResult: undefined,
    actionPlan,
    outcome
  };
}

