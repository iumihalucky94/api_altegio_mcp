import type { DbPool } from '../db';
import { type ScenarioPolicy } from './scenarioPolicy';
import type { ScenarioCode, PolicyResult } from '../types/contracts';
export declare function evaluatePolicy(db: DbPool, scenarioCode: ScenarioCode): Promise<{
    safePolicy: ScenarioPolicy;
    result: PolicyResult;
}>;
//# sourceMappingURL=policySpecialist.d.ts.map