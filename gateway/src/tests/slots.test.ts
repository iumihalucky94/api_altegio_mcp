/**
 * Unit tests for booking slot logic (validate_slot, free slots, working hours).
 * Run: npx ts-node src/tests/slots.test.ts
 */

import assert from 'assert';
import {
  parseScheduleToWorkingSlots,
  parseAppointmentIntervalsForStaff,
  computeFreeSlotStarts,
  validateSlot,
  getServiceDurationSeconds,
  toAltegioDate,
  type WorkingSlot,
  type AppointmentInterval
} from '../altegio/slots';

function run(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    console.error(`  ✗ ${label}`, e);
    throw e;
  }
}

async function main() {
  console.log('Slots unit tests\n');

  run('toAltegioDate formats YYYY-MM-DD to YYYYMMDD', () => {
    assert.strictEqual(toAltegioDate('2026-03-18'), '20260318');
  });

  run('parseScheduleToWorkingSlots extracts slots for date', () => {
    const raw = {
      data: [
        { date: '20260318', is_working: true, slots: [{ from: '10:00', to: '17:00' }] }
      ]
    };
    const slots = parseScheduleToWorkingSlots(raw, '2026-03-18');
    assert.strictEqual(slots.length, 1);
    assert.strictEqual(slots[0].start.toISOString().slice(0, 19), '2026-03-18T09:00:00');
    assert.strictEqual(slots[0].end.toISOString().slice(0, 19), '2026-03-18T16:00:00');
  });

  run('parseAppointmentIntervalsForStaff filters by staff_id', () => {
    const raw = [
      { staff_id: 1, datetime: '2026-03-18T10:00:00+01:00', seance_length: 3600 },
      { staff_id: 2, datetime: '2026-03-18T14:00:00+01:00', seance_length: 1800 }
    ];
    const out = parseAppointmentIntervalsForStaff(raw, 1);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].start.toISOString().slice(0, 19), '2026-03-18T09:00:00');
  });

  run('computeFreeSlotStarts: working 10-17, 1h duration, no appointments', () => {
    const working: WorkingSlot[] = [
      { start: new Date('2026-03-18T09:00:00.000Z'), end: new Date('2026-03-18T16:00:00.000Z') }
    ];
    const appointments: AppointmentInterval[] = [];
    const starts = computeFreeSlotStarts(working, appointments, 3600, 3600);
    assert(starts.length >= 6);
    assert.strictEqual(starts[0].toISOString().slice(0, 19), '2026-03-18T09:00:00');
  });

  run('validateSlot: time outside shift → invalid', () => {
    const working: WorkingSlot[] = [
      { start: new Date('2026-03-18T09:00:00.000Z'), end: new Date('2026-03-18T16:00:00.000Z') }
    ];
    const requested = new Date('2026-03-18T17:00:00.000Z');
    const result = validateSlot(requested, 3600, working, []);
    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as any).reason, 'REQUESTED_TIME_OUTSIDE_MASTER_SCHEDULE');
  });

  run('validateSlot: edge of shift with duration overflow → invalid', () => {
    const working: WorkingSlot[] = [
      { start: new Date('2026-03-18T09:00:00.000Z'), end: new Date('2026-03-18T16:00:00.000Z') }
    ];
    const requested = new Date('2026-03-18T15:30:00.000Z');
    const result = validateSlot(requested, 90 * 60, working, []);
    assert.strictEqual(result.ok, false);
  });

  run('validateSlot: inside shift, no overlap → valid', () => {
    const working: WorkingSlot[] = [
      { start: new Date('2026-03-18T09:00:00.000Z'), end: new Date('2026-03-18T16:00:00.000Z') }
    ];
    const requested = new Date('2026-03-18T10:00:00.000Z');
    const result = validateSlot(requested, 3600, working, []);
    assert.strictEqual(result.ok, true);
  });

  run('validateSlot: overlaps appointment → invalid', () => {
    const working: WorkingSlot[] = [
      { start: new Date('2026-03-18T09:00:00.000Z'), end: new Date('2026-03-18T16:00:00.000Z') }
    ];
    const appointments: AppointmentInterval[] = [
      { start: new Date('2026-03-18T10:00:00.000Z'), end: new Date('2026-03-18T11:00:00.000Z') }
    ];
    const requested = new Date('2026-03-18T10:30:00.000Z');
    const result = validateSlot(requested, 3600, working, appointments);
    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as any).reason, 'SLOT_OCCUPIED');
  });

  run('getServiceDurationSeconds from list shape', () => {
    const raw = [{ id: 100, duration: 3600 }, { id: 200, duration: 2700 }];
    assert.strictEqual(getServiceDurationSeconds(raw, 100), 3600);
    assert.strictEqual(getServiceDurationSeconds(raw, 200), 2700);
    assert.strictEqual(getServiceDurationSeconds(raw, 999), null);
  });

  console.log('\nAll slot tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
