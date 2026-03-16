"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startReminderWorker = startReminderWorker;
const config_1 = require("../config");
const handoff_1 = require("../services/handoff");
async function startReminderWorker(db, log, sendToSummary) {
    let timeout;
    async function run() {
        const enabled = await (0, config_1.getConfigBoolean)('admin_reminder.enabled', true);
        const repeatMin = await (0, config_1.getConfigNumber)('admin_reminder.repeat_every_minutes', 15);
        if (!enabled) {
            timeout = setTimeout(run, repeatMin * 60 * 1000);
            return;
        }
        const firstMin = await (0, config_1.getConfigNumber)('admin_reminder.first_after_minutes', 10);
        const maxReminders = await (0, config_1.getConfigNumber)('admin_reminder.max_reminders', 20);
        const actions = await (0, handoff_1.getOpenPendingActions)(db);
        const now = Date.now();
        for (const a of actions) {
            if (a.reminder_count >= maxReminders)
                continue;
            const created = new Date(a.created_at).getTime();
            const lastReminded = a.last_reminded_at ? new Date(a.last_reminded_at).getTime() : 0;
            const firstThreshold = created + firstMin * 60 * 1000;
            const nextThreshold = lastReminded + repeatMin * 60 * 1000;
            if (lastReminded === 0 && now < firstThreshold)
                continue;
            if (lastReminded > 0 && now < nextThreshold)
                continue;
            const msg = `Reminder: pending ${a.type} for ${a.client_phone} (case: ${a.case_id || '—'}, approval: ${a.approval_id || '—'})`;
            await sendToSummary(msg);
            await (0, handoff_1.updateReminder)(db, a.id);
        }
        timeout = setTimeout(run, repeatMin * 60 * 1000);
    }
    const firstMin = await (0, config_1.getConfigNumber)('admin_reminder.first_after_minutes', 10);
    timeout = setTimeout(run, firstMin * 60 * 1000);
    log.info('Reminder worker started');
}
//# sourceMappingURL=reminder.js.map