import type { DbPool } from '../db';
import { getConfigNumber } from '../config';

export async function startAuditCleanupWorker(db: DbPool, log: any) {
  async function runOnce() {
    try {
      const days = await getConfigNumber('AUDIT_RETENTION_DAYS', 180);
      if (days <= 0) return;
      await db.query('DELETE FROM audit_log WHERE ts < now() - ($1::int || \' days\')::interval', [
        days
      ]);
    } catch (err) {
      log.warn({ err }, 'Audit cleanup worker failed');
    }
  }

  // Run once per 24h
  setTimeout(() => {
    void runOnce();
    setInterval(runOnce, 24 * 60 * 60 * 1000);
  }, 5 * 60 * 1000);
}

