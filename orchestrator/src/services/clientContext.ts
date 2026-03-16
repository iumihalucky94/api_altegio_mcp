import type { ClientContext, ConversationSnapshot, UpcomingAppointmentSummary } from '../types/contracts';
import type { ResolvedLanguage } from './localization';
import type { BehaviorOverride } from './behaviorOverrides';
import type { ConversationRow } from './conversation';

export interface BuildClientContextParams {
  phoneE164: string;
  conversation: ConversationRow;
  lastMessages: Array<{ ts: string; direction: string; author: string; text: string }>;
  behaviorOverride: BehaviorOverride | null;
  detectedLanguage: ResolvedLanguage;
  languageHint: string | null;
  kbContextSummary?: string;
  upcomingAppointments?: Array<{ id?: string; start?: string; service?: string; master?: string }>;
}

export function buildClientContext(params: BuildClientContextParams): ClientContext {
  const {
    phoneE164,
    conversation,
    lastMessages,
    behaviorOverride,
    detectedLanguage,
    languageHint,
    kbContextSummary,
    upcomingAppointments
  } = params;

  const snapshot: ConversationSnapshot = {
    row: conversation,
    lastMessages: lastMessages.map((m) => ({
      ts: m.ts,
      from: m.author === 'client' ? 'client' : m.author === 'admin' ? 'admin' : 'agent',
      text: m.text
    })),
    upcomingSummary: summarizeUpcoming(upcomingAppointments)
  };

  const context: ClientContext = {
    phoneE164,
    conversation: snapshot,
    behaviorOverride,
    language: {
      detected: detectedLanguage,
      hint: languageHint
    },
    kbContextSummary
  };

  return context;
}

function summarizeUpcoming(
  list?: Array<{ id?: string; start?: string; service?: string; master?: string }>
): UpcomingAppointmentSummary | undefined {
  if (!list || !list.length) return undefined;
  const sorted = [...list].sort((a, b) => {
    const ta = a.start ? Date.parse(a.start) : 0;
    const tb = b.start ? Date.parse(b.start) : 0;
    return ta - tb;
  });
  return {
    count: list.length,
    nearestDate: sorted[0]?.start
  };
}

