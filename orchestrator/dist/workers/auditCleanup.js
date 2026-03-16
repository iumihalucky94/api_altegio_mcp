"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAuditCleanupWorker = startAuditCleanupWorker;
const config_1 = require("../config");
async function startAuditCleanupWorker(db, log) {
    async function runOnce() {
        try {
            const days = await (0, config_1.getConfigNumber)('AUDIT_RETENTION_DAYS', 180);
            if (days <= 0)
                return;
            await db.query('DELETE FROM audit_log WHERE ts < now() - ($1::int || \' days\')::interval', [
                days
            ]);
        }
        catch (err) {
            log.warn({ err }, 'Audit cleanup worker failed');
        }
    }
    // Run once per 24h
    setTimeout(() => {
        void runOnce();
        setInterval(runOnce, 24 * 60 * 60 * 1000);
    }, 5 * 60 * 1000);
}
//# sourceMappingURL=auditCleanup.js.map