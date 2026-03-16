import type { ResolvedLanguage } from './localization';
import { getSystemMessage } from './localization';
import type { ScenarioCode } from '../types/contracts';

export interface ReplyQaGuardInput {
  scenarioCode: ScenarioCode;
  language: ResolvedLanguage;
  text: string;
  writerUsedFallback: boolean;
  allowAgentToReply: boolean;
  bookingToolSucceeded?: boolean;
  replyLooksConfirmed?: boolean;
}

export interface ReplyQaIssue {
  code: 'language_mismatch' | 'forbidden_phrase' | 'unsafe_confirmation' | 'empty_or_weak';
  message: string;
}

export interface ReplyQaGuardResult {
  approved: boolean;
  fallbackUsed: boolean;
  finalText: string;
  issues: ReplyQaIssue[];
}

const FORBIDDEN_PHRASES = [
  'das ist unmöglich',
  'das geht nicht',
  'wir machen das nicht',
  'regeln sind regeln',
  'das ist ihr problem',
  'sie hätten früher schreiben sollen',
  'da kann ich nichts machen',
  'wenn es ihnen nicht passt',
  'andere kundinnen schaffen das auch'
];

export function runReplyQaGuard(input: ReplyQaGuardInput): ReplyQaGuardResult {
  const { language, text, writerUsedFallback, allowAgentToReply, bookingToolSucceeded, replyLooksConfirmed } = input;
  const issues: ReplyQaIssue[] = [];
  let finalText = text;
  let fallbackUsed = writerUsedFallback;

  const normalized = (text || '').trim();

  if (!allowAgentToReply) {
    issues.push({ code: 'empty_or_weak', message: 'Reply not allowed by policy; using generic ack.' });
    finalText = getSystemMessage('generic_ack', language);
    return {
      approved: true,
      fallbackUsed: true,
      finalText,
      issues
    };
  }

  if (!normalized || normalized.length < 3) {
    issues.push({ code: 'empty_or_weak', message: 'Reply is empty or too short.' });
    finalText = getSystemMessage('generic_ack', language);
    fallbackUsed = true;
  }

  const hasCyrillic = /[А-Яа-яЁё]/.test(normalized);
  const hasLatin = /[A-Za-z]/.test(normalized);
  const hasGermanUmlaut = /[äöüß]/i.test(normalized);

  if (language === 'ru' && !hasCyrillic && (hasLatin || hasGermanUmlaut)) {
    issues.push({ code: 'language_mismatch', message: 'Reply appears non-Russian while effective language is ru.' });
    finalText = getSystemMessage('generic_ack', language);
    fallbackUsed = true;
  } else if (language === 'de' && !hasLatin && !hasGermanUmlaut && hasCyrillic) {
    issues.push({ code: 'language_mismatch', message: 'Reply appears non-German while effective language is de.' });
    finalText = getSystemMessage('generic_ack', language);
    fallbackUsed = true;
  } else if (language === 'en' && !hasLatin && hasCyrillic) {
    issues.push({ code: 'language_mismatch', message: 'Reply appears non-English while effective language is en.' });
    finalText = getSystemMessage('generic_ack', language);
    fallbackUsed = true;
  }

  const lower = normalized.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase)) {
      issues.push({ code: 'forbidden_phrase', message: `Forbidden phrase detected: "${phrase}".` });
      finalText = getSystemMessage('generic_ack', language);
      fallbackUsed = true;
      break;
    }
  }

  if (replyLooksConfirmed && bookingToolSucceeded === false) {
    issues.push({
      code: 'unsafe_confirmation',
      message: 'Reply sounds like a confirmation but booking tool is not marked as succeeded.'
    });
  }

  return {
    approved: true,
    fallbackUsed,
    finalText,
    issues
  };
}

