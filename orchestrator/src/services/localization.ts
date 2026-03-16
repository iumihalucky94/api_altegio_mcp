import type { LanguageCode } from './intent';

/** Resolved language for reply (no 'mixed'); used for getSystemMessage. */
export type ResolvedLanguage = 'de' | 'ru' | 'en';

const VALID_RESOLVED: ResolvedLanguage[] = ['de', 'ru', 'en'];

const MESSAGES: Record<string, Record<ResolvedLanguage, string>> = {
  booking_failed: {
    de: 'Leider ist bei der Buchung etwas schiefgelaufen. Ich habe Ihre Anfrage an unser Team weitergeleitet – wir melden uns in Kürze bei Ihnen.',
    ru: 'К сожалению, при записи произошла ошибка. Я передал(а) ваш запрос нашей команде — мы свяжемся с вами в ближайшее время.',
    en: 'Unfortunately something went wrong with the booking. I have forwarded your request to our team – we will get back to you shortly.'
  },
  booking_not_confirmed_fallback: {
    de: 'Leider kann ich die Buchung nicht automatisch bestätigen. Ich habe Ihre Anfrage an unser Team weitergeleitet – wir melden uns in Kürze bei Ihnen.',
    ru: 'К сожалению, я не могу автоматически подтвердить запись. Я передал(а) ваш запрос нашей команде — мы свяжемся с вами в ближайшее время.',
    en: 'Unfortunately I cannot confirm the booking automatically. I have forwarded your request to our team – we will get back to you shortly.'
  },
  generic_ack: {
    de: 'Vielen Dank für Ihre Nachricht. Unser Team meldet sich in Kürze bei Ihnen.',
    ru: 'Спасибо за ваше сообщение. Наша команда свяжется с вами в ближайшее время.',
    en: 'Thank you for your message. Our team will get back to you shortly.'
  },
  handoff_ack: {
    de: 'Ich habe Ihre Nachricht an unser Team weitergeleitet. Sie melden sich in Kürze bei Ihnen.',
    ru: 'Я передал(а) ваше сообщение нашей команде. Они свяжутся с вами в ближайшее время.',
    en: 'I forwarded your message to our team. They will get back to you as soon as possible.'
  },
  upcoming_appointments: {
    de: 'Sie haben {{n}} anstehende Termin(e). Möchten Sie umbuchen oder stornieren? Schreiben Sie uns einfach.',
    ru: 'У вас {{n}} предстоящих записей. Нужно перенести или отменить? Напишите, пожалуйста.',
    en: 'You have {{n}} upcoming appointment(s). Need to reschedule or cancel? Reply with your request.'
  },
  generic_reply: {
    de: 'Vielen Dank für Ihre Nachricht. Unser Team meldet sich in Kürze bei Ihnen.',
    ru: 'Спасибо за ваше сообщение. Наша команда свяжется с вами в ближайшее время.',
    en: 'Thanks for your message. Our team will get back to you shortly.'
  },
  requested_date_not_open: {
    de: 'An diesem Tag haben wir geschlossen. Bitte wählen Sie einen anderen Tag.',
    ru: 'В этот день мы не работаем. Пожалуйста, выберите другой день.',
    en: 'We are closed on that day. Please choose another day.'
  },
  working_time_violation: {
    de: 'Zu der gewünschten Zeit haben wir leider keine freien Plätze. Hier sind Alternativen: {{slots}}',
    ru: 'На выбранное время нет свободных мест. Вот варианты: {{slots}}',
    en: 'We have no availability at the requested time. Here are alternatives: {{slots}}'
  },
  working_time_violation_no_slots: {
    de: 'Zu der gewünschten Zeit sind wir leider ausgebucht. Bitte wählen Sie einen anderen Tag.',
    ru: 'На это время нет свободных мест. Пожалуйста, выберите другой день.',
    en: 'We have no availability at that time. Please choose another day.'
  },
  alternative_slots_intro: {
    de: 'Hier sind mögliche Termine: {{slots}}',
    ru: 'Вот возможные варианты: {{slots}}',
    en: 'Here are some options: {{slots}}'
  },
  slots_available: {
    de: 'Am {{date}} haben wir folgende freie Termine: {{slots}}. Möchten Sie einen davon buchen?',
    ru: 'На {{date}} есть такие окна: {{slots}}. Хотите записаться на одно из них?',
    en: 'On {{date}} we have these free slots: {{slots}}. Would you like to book one?'
  },
  day_alternatives: {
    de: 'An diesem Tag haben wir geschlossen. Wie passt es Ihnen an {{days}}?',
    ru: 'В этот день мы не работаем. Как вам будет удобнее — в {{days}}?',
    en: 'We are closed on that day. Would {{days}} work for you?'
  }
};

/**
 * Resolve effective reply language when detectLanguage returns 'mixed'.
 * Order: (1) language_preference (client_behavior_overrides), (2) conversation.language_hint,
 * (3) heuristics from latest message text, (4) default 'de'.
 */
export function resolveReplyLanguage(
  batchText: string,
  languageHint?: string | null,
  languagePreference?: string | null
): ResolvedLanguage {
  const hint = (languagePreference ?? languageHint ?? '').trim().toLowerCase();
  if (hint === 'de' || hint === 'ru' || hint === 'en') return hint as ResolvedLanguage;

  const lastLine = (batchText || '').trim().split(/\n/).filter(Boolean).pop() ?? '';
  const t = lastLine.trim();
  if (!t) return 'de';

  const hasCyrillic = /[А-Яа-яЁё]/.test(t);
  const hasGermanUmlaut = /[äöüß]/i.test(t);
  const hasGermanWords = /\b(termin|bitte|danke|nicht|gern|sie\b|ihr\b|unsere?)\b/i.test(t);
  const hasRussianWords = /\b(спасибо|запись|можно|нужно|привет|здравствуйте|пожалуйста)\b/i.test(t);
  const hasEnglishWords = /\b(thanks|please|hello|hi|appointment|booking|need)\b/i.test(t);

  if (hasCyrillic && (hasRussianWords || !hasLatin(t))) return 'ru';
  if (hasGermanUmlaut || hasGermanWords) return 'de';
  if (hasEnglishWords && hasLatin(t)) return 'en';
  if (hasCyrillic) return 'ru';
  if (hasLatin(t)) return 'en';
  return 'de';
}

function hasLatin(s: string): boolean {
  return /[A-Za-z]/.test(s);
}

/**
 * Get effective language for localization: if lang is 'mixed', resolve via resolveReplyLanguage;
 * otherwise use lang (must be de|ru|en for lookup).
 */
export function effectiveLangForReply(
  lang: LanguageCode,
  batchText: string,
  languageHint?: string | null,
  languagePreference?: string | null
): ResolvedLanguage {
  if (lang !== 'mixed' && VALID_RESOLVED.includes(lang as ResolvedLanguage)) {
    return lang as ResolvedLanguage;
  }
  return resolveReplyLanguage(batchText, languageHint, languagePreference);
}

/**
 * Returns system message by key and language. Optional vars for template substitution (e.g. { n: 3 } for {{n}}).
 */
export function getSystemMessage(
  key: string,
  lang: ResolvedLanguage,
  vars?: Record<string, string | number>
): string {
  const resolved = VALID_RESOLVED.includes(lang) ? lang : 'de';
  const map = MESSAGES[key];
  let text = (map && map[resolved]) ?? (map && map.de) ?? '';
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }
  return text;
}
