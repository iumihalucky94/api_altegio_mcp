import type { DbPool } from '../db';
export interface BehaviorOverride {
    phone: string;
    language_preference: string | null;
    tone_profile: string | null;
    force_handoff: boolean;
    notes_for_agent: string | null;
    blocked_topics: string[] | null;
    updated_at: string;
    updated_by: string;
}
export declare function getBehaviorOverride(db: DbPool, phone: string): Promise<BehaviorOverride | null>;
export declare function setRule(db: DbPool, phone: string, key: string, value: string | boolean, by?: string): Promise<void>;
//# sourceMappingURL=behaviorOverrides.d.ts.map