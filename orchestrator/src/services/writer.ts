import type { ResolvedLanguage } from './localization';
import { getSystemMessage } from './localization';
import type { ScenarioCode, PolicyResult } from '../types/contracts';

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

export function writeReply(input: WriterInput): WriterOutput {
  const { language, replyCandidate, allowAgentToReply } = input;

  if (!allowAgentToReply) {
    const text = getSystemMessage('generic_ack', language);
    return { text, usedFallback: true };
  }

  if (replyCandidate && replyCandidate.trim().length > 0) {
    return { text: replyCandidate, usedFallback: false };
  }

  const text = getSystemMessage('generic_ack', language);
  return { text, usedFallback: true };
}

