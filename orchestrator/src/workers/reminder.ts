import type { DbPool } from '../db';
import { getConfigNumber, getConfigBoolean } from '../config';
import { getOpenPendingActions, updateReminder } from '../services/handoff';

export async function startReminderWorker(
  db: DbPool,
  log: any,
  sendToSummary: (msg: string) => Promise<void>
) {
  let timeout: NodeJS.Timeout;

  async function run() {
    const enabled = await getConfigBoolean('admin_reminder.enabled', true);
    const repeatMin = await getConfigNumber('admin_reminder.repeat_every_minutes', 15);
    if (!enabled) {
      timeout = setTimeout(run, repeatMin * 60 * 1000);
      return;
    }
    const firstMin = await getConfigNumber('admin_reminder.first_after_minutes', 10);
    const maxReminders = await getConfigNumber('admin_reminder.max_reminders', 20);

    const actions = await getOpenPendingActions(db);
    const now = Date.now();
    for (const a of actions) {
      if (a.reminder_count >= maxReminders) continue;
      const created = new Date(a.created_at).getTime();
      const lastReminded = a.last_reminded_at ? new Date(a.last_reminded_at).getTime() : 0;
      const firstThreshold = created + firstMin * 60 * 1000;
      const nextThreshold = lastReminded + repeatMin * 60 * 1000;
      if (lastReminded === 0 && now < firstThreshold) continue;
      if (lastReminded > 0 && now < nextThreshold) continue;

      const msg = `Reminder: pending ${a.type} for ${a.client_phone} (case: ${a.case_id || '—'}, approval: ${a.approval_id || '—'})`;
      await sendToSummary(msg);
      await updateReminder(db, a.id);
    }
    timeout = setTimeout(run, repeatMin * 60 * 1000);
  }

  const firstMin = await getConfigNumber('admin_reminder.first_after_minutes', 10);
  timeout = setTimeout(run, firstMin * 60 * 1000);
  log.info('Reminder worker started');
}
