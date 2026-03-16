import type { ScenarioCode } from '../types/contracts';
import type { HandoffPreparationResult } from '../types/contracts';
import type { HandoffReasonCode, HandoffPriority } from '../types/reasonCodes';

export interface HandoffSpecialistInput {
  scenarioCode: ScenarioCode;
  reasonCode: HandoffReasonCode;
  confidence?: number;
  summary: string;
  replyPreview?: string;
  tags?: string[];
}

export function prepareHandoff(input: HandoffSpecialistInput): HandoffPreparationResult {
  const { scenarioCode, reasonCode, confidence, summary, replyPreview, tags } = input;

  let priority: HandoffPriority = 'normal';
  if (reasonCode === 'ai_agent_failed' || reasonCode === 'fake_confirmation_blocked' || reasonCode === 'booking_failed') {
    priority = 'high';
  } else if (reasonCode === 'schedule_violation') {
    priority = 'normal';
  } else if (reasonCode === 'policy_forced_handoff') {
    priority = 'high';
  } else if (reasonCode === 'low_confidence') {
    priority = 'normal';
  }

  const baseSummary = summary.slice(0, 500);

  const questionToAdmin = buildQuestionToAdmin({
    scenarioCode,
    reasonCode,
    confidence
  });

  return {
    shouldHandoff: true,
    reasonCode,
    priority,
    summary: baseSummary,
    questionToAdmin,
    tags
  };
}

function buildQuestionToAdmin(params: {
  scenarioCode: ScenarioCode;
  reasonCode: HandoffReasonCode;
  confidence?: number;
}): string {
  const { scenarioCode, reasonCode, confidence } = params;

  if (reasonCode === 'low_confidence') {
    return `Пожалуйста, посмотрите этот диалог: модель не уверена в ответе (сценарий: ${scenarioCode}, уверенность: ${confidence ?? 'n/a'}).`;
  }

  if (reasonCode === 'need_approval') {
    return `Нужна проверка и подтверждение действия по сценарию ${scenarioCode}.`;
  }

  if (reasonCode === 'booking_failed' || reasonCode === 'schedule_violation') {
    return `Пожалуйста, помогите с расписанием/записью: автоматическое бронирование не удалось (сценарий: ${scenarioCode}).`;
  }

  if (reasonCode === 'fake_confirmation_blocked') {
    return `Модель заявила об успешной записи, но create_appointment не был выполнен. Проверьте и скорректируйте запись вручную.`;
  }

  if (reasonCode === 'ai_agent_failed') {
    return `Модель не смогла корректно обработать запрос. Пожалуйста, возьмите диалог на себя.`;
  }

  if (reasonCode === 'policy_forced_handoff') {
    return `Политика запрещает автоматическое действие. Пожалуйста, примите решение по сценарию ${scenarioCode}.`;
  }

  return 'Please handle this conversation.';
}

