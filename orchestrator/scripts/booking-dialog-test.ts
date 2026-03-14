/**
 * Тест диалога: запись к Адель на время вне графика мастера.
 * 1) Через MCP получаем расписание и свободные слоты Адель на дату.
 * 2) Выбираем время, когда мастер уже не работает (например 18:00 при смене до 17:00).
 * 3) Прогоняем диалог с ИИ с контекстом FREE_SLOTS (без этого времени).
 * 4) Проверяем: бот НЕ должен подтверждать запись на нерабочее время.
 *
 * Запуск из корня api_altegio_mcp:
 *   npx ts-node --transpile-only orchestrator/scripts/booking-dialog-test.ts
 * Требуется: .env (OPENAI_API_KEY, MCP_GATEWAY_URL, DEFAULT_COMPANY_ID), gateway на порту 3030.
 */

import dotenv from 'dotenv';
import path from 'path';

// Загрузка .env: из текущей папки (orchestrator) и из корня проекта (api_altegio_mcp).
// При запуске в Docker монтируйте .env: -v "$(pwd)/.env:/app/.env:ro" и задайте WORKDIR=/app.
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve('/app/.env') // при docker run -v project/.env:/app/.env
];
for (const p of envPaths) {
  const r = dotenv.config({ path: p });
  if (r.parsed && Object.keys(r.parsed).length) break;
}

const MCP_URL = (process.env.MCP_GATEWAY_URL || 'http://localhost:3030').replace(/\/$/, '');
const COMPANY_ID = Number(process.env.DEFAULT_COMPANY_ID) || 1169276;
// Как в orchestrator: поддержка обоих имён переменной из .env
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.AI_AGENT_API_KEY || '';
const REQUEST_ID = `test-${Date.now()}`;

async function callMcp(tool: string, payload: Record<string, unknown>): Promise<{ result?: unknown; error?: unknown }> {
  const res = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id: REQUEST_ID,
      actor: { agent_id: 'test-script', role: 'agent' },
      company_id: COMPANY_ID,
      tool,
      payload
    })
  });
  const data = (await res.json()) as { result?: unknown; error?: unknown };
  if (!res.ok) throw new Error(`MCP ${tool} failed: ${res.status}`);
  return data;
}

function findStaffByName(staff: Array<{ id: number; name?: string }>, name: string): { id: number; name?: string } | null {
  const lower = name.toLowerCase();
  for (const s of staff) {
    if ((s.name ?? '').toLowerCase().includes(lower)) return s;
    if (lower.includes((s.name ?? '').toLowerCase())) return s;
  }
  return null;
}

async function main() {
  console.log('=== Booking dialog test: no confirmation for non-working time ===\n');
  console.log('MCP_URL:', MCP_URL, '| COMPANY_ID:', COMPANY_ID);

  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY (или AI_AGENT_API_KEY) не задан в .env. Проверьте, что ключ есть в загруженном .env.');
    process.exit(1);
  }
  console.log('OPENAI_API_KEY загружен из .env');
  console.log('AI_AGENT_API_BASE_URL:', process.env.AI_AGENT_API_BASE_URL || '(default https://api.openai.com/v1)');

  const staffRes = await callMcp('crm.list_staff', { company_id: COMPANY_ID });
  const rawList = (staffRes.result as { staff?: unknown })?.staff;
  const rawArr = Array.isArray(rawList) ? rawList : (rawList && typeof rawList === 'object' && Array.isArray((rawList as any).data) ? (rawList as any).data : []);
  const staff = rawArr.map((s: any) => ({
    id: Number(s?.id ?? s?.team_member_id ?? s),
    name: String(s?.name ?? s?.full_name ?? s?.title ?? '')
  })).filter((s) => Number.isFinite(s.id));
  const adel = findStaffByName(staff, 'adel') ?? findStaffByName(staff, 'адель') ?? staff[0];
  if (!adel) {
    console.error('Staff not found (need Adel or any). Raw list_staff result:', JSON.stringify(staffRes.result).slice(0, 500));
    process.exit(1);
  }
  console.log('Staff (Adel):', adel.id, adel.name);

  const servicesRes = await callMcp('crm.list_services', { company_id: COMPANY_ID });
  const servicesRaw = (servicesRes.result as { services?: unknown })?.services;
  const servicesArr = Array.isArray(servicesRaw) ? servicesRaw : (servicesRaw && typeof servicesRaw === 'object' && Array.isArray((servicesRaw as any).data) ? (servicesRaw as any).data : []);
  const services = servicesArr.map((s: any) => ({ id: Number(s?.id ?? s?.service_id ?? s), name: String(s?.name ?? s?.title ?? '') })).filter((s) => Number.isFinite(s.id));
  const service = services[0];
  if (!service?.id) {
    console.error('No services. Raw result:', JSON.stringify(servicesRes.result).slice(0, 400));
    process.exit(1);
  }
  console.log('Service:', service.id, service.name);

  const date = new Date();
  date.setDate(date.getDate() + 14);
  const dateYmd = date.toISOString().slice(0, 10);

  let workingHours: Array<{ start: string; end: string }> = [];
  let freeSlots: string[] = [];
  try {
    const hoursRes = await callMcp('crm.get_master_working_hours', {
      company_id: COMPANY_ID,
      staff_id: adel.id,
      date: dateYmd
    });
    workingHours = ((hoursRes.result as { working_hours?: Array<{ start: string; end: string }> })?.working_hours) ?? [];
    console.log('Working hours', dateYmd, ':', workingHours.length ? workingHours : '(none)');
  } catch (e) {
    console.warn('get_master_working_hours failed:', (e as Error).message);
  }

  try {
    const slotsRes = await callMcp('crm.get_free_slots', {
      company_id: COMPANY_ID,
      staff_id: adel.id,
      service_id: service.id,
      date: dateYmd
    });
    freeSlots = ((slotsRes.result as { free_slots?: string[] })?.free_slots) ?? [];
    console.log('Free slots count:', freeSlots.length);
    if (freeSlots.length) console.log('First 3:', freeSlots.slice(0, 3));
  } catch (e) {
    console.warn('get_free_slots failed:', (e as Error).message);
  }

  const nonWorkingTime = `${dateYmd}T18:00:00+01:00`;
  const nonWorkingOk = !freeSlots.some((s) => s.includes('18:00') || s.includes('T18:'));
  console.log('\nNon-working time to request:', nonWorkingTime, '| 18:00 not in free_slots:', nonWorkingOk);

  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: 'Client: привет, нужна запись на реснички' },
    {
      role: 'assistant',
      content: 'Привет! Мы будем рады записать вас. Пожалуйста, сообщите, какой день и время вам удобны, и мы подберём вариант.'
    },
    {
      role: 'user',
      content: `Client: а у меня уже вроде и так есть пару записей нет? Хотелось бы на ${dateYmd.slice(8, 10)}.${dateYmd.slice(5, 7)} к Адель, будет возможно?`
    },
    {
      role: 'assistant',
      content: `У вас есть записи. Мы можем записать вас на ${dateYmd} к ${adel.name}. Вот доступное время: ${freeSlots.slice(0, 3).map((s) => s.slice(11, 16)).join(', ') || 'уточните у администратора'}. Подтвердите, пожалуйста, удобное время.`
    },
    { role: 'user', content: 'Client: 18:00 устроит. Подтверждаю.' }
  ];

  const { callAiAgent } = await import('../src/services/aiAgent');

  const context = {
    company_id: COMPANY_ID,
    services: services.slice(0, 5),
    staff: staff.slice(0, 10),
    client_phone_e164: '+4367762665083',
    businessHours: { timezone: 'Europe/Vienna', start: '08:00', end: '20:00' },
    free_slots: freeSlots
  };

  const log = {
    warn: (o: object, m?: string) => console.warn(m, o),
    error: (o: object, m?: string) => {
      console.error(m || 'AI agent error', o);
    }
  };
  const result = await callAiAgent(
    OPENAI_API_KEY,
    process.env.AI_AGENT_API_BASE_URL || undefined,
    process.env.AI_AGENT_MODEL || 'gpt-4o-mini',
    conversationHistory,
    context,
    log
  );

  console.log('\n--- AI response ---');
  if (!result) {
    console.log('(no result / null)');
    process.exit(1);
  }
  console.log('Decision:', result.decision);
  console.log('Confidence:', result.confidence);
  console.log('Reply text:', result.reply_text ?? '(null)');
  const createCalls = (result.mcp_calls || []).filter((c: any) => c?.tool === 'crm.create_appointment');
  console.log('create_appointment calls:', createCalls.length);
  for (const c of createCalls) {
    const dt = (c as any).payload?.datetime;
    console.log('  datetime:', dt);
  }

  const replyConfirmsBooking =
    result.reply_text &&
    /подтвержден|confirmed|забронирован|записан|записали|ждём вас|ждите вас/i.test(result.reply_text) &&
    /18:00|18\s*:?\s*00/.test(result.reply_text);
  const createAppointmentFor18 =
    createCalls.some((c: any) => {
      const dt = String((c as any).payload?.datetime ?? '');
      return dt.includes('18:00') || dt.includes('T18:');
    });
  const confirmsNonWorking = replyConfirmsBooking || createAppointmentFor18;

  if (confirmsNonWorking) {
    console.error('\n❌ FAIL: Bot confirmed or created booking for non-working time (18:00).');
    process.exit(1);
  }
  console.log('\n✅ PASS: Bot did not confirm booking for non-working time.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
