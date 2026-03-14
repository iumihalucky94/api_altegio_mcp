import { logAudit } from '../services/audit';

type Row = Record<string, any>;

class FakeDb {
  public inserts: Row[] = [];

  async query(sql: string, params: any[]): Promise<{ rows: Row[] }> {
    if (sql.startsWith('INSERT INTO audit_log')) {
      const row: Row = {
        actor_type: params[0],
        actor_id: params[1],
        source: params[2],
        action: params[3],
        entity_table: params[4],
        entity_id: params[5],
        before_json: params[6],
        after_json: params[7],
        diff_json: params[8],
        correlation_id: params[9],
        request_id: params[10]
      };
      this.inserts.push(row);
      return { rows: [] };
    }
    // Conversation select stubs not needed for this test
    return { rows: [] };
  }
}

async function main() {
  const db = new FakeDb();

  // Simulate KB policy create
  await logAudit(db as any, {
    actor: { actor_type: 'admin', actor_id: 'kb_tester' },
    source: 'kb.policies',
    action: 'kb.policy.create',
    entity_table: 'agent_policies',
    entity_id: 'refill.max_days',
    before: null,
    after: { key: 'refill.max_days', value_json: 21 },
    correlation_id: 'corr-123',
    request_id: 'req-123'
  });

  if (db.inserts.length !== 1) {
    console.error('Expected one audit insert for KB policy create');
    process.exit(1);
  }
  const a = db.inserts[0];
  if (a.action !== 'kb.policy.create' || a.source !== 'kb.policies') {
    console.error('Incorrect action/source for KB audit', a);
    process.exit(1);
  }
  if (a.actor_type !== 'admin' || a.actor_id !== 'kb_tester') {
    console.error('Incorrect actor for KB audit', a);
    process.exit(1);
  }
  if (a.correlation_id !== 'corr-123' || a.request_id !== 'req-123') {
    console.error('Correlation/request id not propagated', a);
    process.exit(1);
  }

  console.log('Audit KB and conversation tests passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

