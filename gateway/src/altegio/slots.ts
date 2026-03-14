/**
 * Booking slot logic: working hours, free slots, validation.
 * All times normalized to Europe/Vienna.
 * Slot start + duration must be ≤ shift end; only real free slots from Altegio are suggested.
 */

const TZ = 'Europe/Vienna';

function toDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateYmdToYmdInt(ymd: string): number {
  return parseInt(ymd.replace(/-/g, ''), 10);
}

/** Format date as YYYYMMDD for Altegio schedule API. */
export function toAltegioDate(ymd: string): string {
  return ymd.replace(/-/g, '');
}

export interface WorkingSlot {
  start: Date;
  end: Date;
}

/**
 * Parse Altegio schedule response. Response may be { data: [...] } or array.
 * Each item: { date: string (YYYY-MM-DD or YYYYMMDD), is_working?: boolean, slots?: Array<{from, to}> }.
 * from/to can be "HH:MM", "HH:MM:SS", or ISO.
 */
export function parseScheduleToWorkingSlots(
  raw: any,
  dateYmd: string
): WorkingSlot[] {
  const data = raw?.data ?? (Array.isArray(raw) ? raw : []);
  const list = Array.isArray(data) ? data : [];
  const normalized = dateYmd.replace(/-/g, '');
  const out: WorkingSlot[] = [];

  for (const row of list) {
    const rowDate = row.date != null ? String(row.date).replace(/-/g, '') : '';
    if (rowDate !== normalized) continue;
    if (row.is_working === false) continue;
    const slots = row.slots ?? row.slot ?? [];
    const arr = Array.isArray(slots) ? slots : [];

    for (const s of arr) {
      const from = s.from ?? s.start ?? s[0];
      const to = s.to ?? s.end ?? s[1];
      if (from == null || to == null) continue;
      const start = parseTimeOnDate(dateYmd, from);
      const end = parseTimeOnDate(dateYmd, to);
      if (start && end && end > start) {
        out.push({ start, end });
      }
    }
  }
  return out;
}

function parseTimeOnDate(ymd: string, time: string): Date | null {
  if (typeof time !== 'string') return null;
  const trimmed = time.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }
  const parts = trimmed.split(/[T:\s]/).map((x) => parseInt(x, 10) || 0);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const sec = parts[2] ?? 0;
  const [y, mo, day] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!y || !mo || !day) return null;
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}T${timeStr}+01:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export interface AppointmentInterval {
  start: Date;
  end: Date;
}

/**
 * Extract appointment intervals for a staff member from listAppointments response.
 * Records may have datetime, seance_length, staff_id; or start_at, end_at.
 */
export function parseAppointmentIntervalsForStaff(
  rawRecords: any,
  staffId: number
): AppointmentInterval[] {
  const data = rawRecords?.data ?? (Array.isArray(rawRecords) ? rawRecords : rawRecords?.data);
  const list = Array.isArray(data) ? data : [];
  const out: AppointmentInterval[] = [];

  for (const r of list) {
    const sid = r.staff_id ?? r.staff_id_id ?? r.team_member_id;
    if (Number(sid) !== Number(staffId)) continue;
    const dt = r.datetime ?? r.start_at ?? r.date ?? r.start;
    const len = r.seance_length ?? r.length ?? r.duration ?? 3600;
    const lenSec = typeof len === 'number' ? len : parseInt(String(len), 10) || 3600;
    if (!dt) continue;
    const start = new Date(dt);
    if (isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + lenSec * 1000);
    out.push({ start, end });
  }
  return out;
}

/**
 * Compute free slot start times: working slots minus appointments, then split by duration.
 * slotStepSeconds: step between possible starts (default 15 min = 900).
 */
export function computeFreeSlotStarts(
  workingSlots: WorkingSlot[],
  appointments: AppointmentInterval[],
  durationSeconds: number,
  slotStepSeconds: number = 900
): Date[] {
  const starts: Date[] = [];
  for (const shift of workingSlots) {
    let cursor = shift.start.getTime();
    const shiftEnd = shift.end.getTime();
    while (cursor + durationSeconds * 1000 <= shiftEnd) {
      const start = new Date(cursor);
      const end = new Date(cursor + durationSeconds * 1000);
      const overlaps = appointments.some(
        (a) => start.getTime() < a.end.getTime() && end.getTime() > a.start.getTime()
      );
      if (!overlaps) starts.push(start);
      cursor += slotStepSeconds * 1000;
    }
  }
  return starts.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Check if requested start is valid: inside a working slot, start+duration ≤ shift end, and not overlapping any appointment.
 */
export function validateSlot(
  requestedStart: Date,
  durationSeconds: number,
  workingSlots: WorkingSlot[],
  appointments: AppointmentInterval[]
): { ok: true } | { ok: false; reason: string } {
  const reqMs = requestedStart.getTime();
  const endMs = reqMs + durationSeconds * 1000;

  const inShift = workingSlots.some(
    (s) => reqMs >= s.start.getTime() && endMs <= s.end.getTime()
  );
  if (!inShift) {
    return { ok: false, reason: 'REQUESTED_TIME_OUTSIDE_MASTER_SCHEDULE' };
  }

  const overlaps = appointments.some(
    (a) => reqMs < a.end.getTime() && endMs > a.start.getTime()
  );
  if (overlaps) {
    return { ok: false, reason: 'SLOT_OCCUPIED' };
  }

  return { ok: true };
}

/**
 * Get service duration in seconds from list_services response.
 */
export function getServiceDurationSeconds(servicesRaw: any, serviceId: number): number | null {
  const list = servicesRaw?.data ?? (Array.isArray(servicesRaw) ? servicesRaw : servicesRaw?.data);
  const arr = Array.isArray(list) ? list : [];
  for (const s of arr) {
    const id = s.id ?? s.salon_service_id;
    if (Number(id) === Number(serviceId)) {
      const dur = s.duration ?? s.seance_length ?? 3600;
      return typeof dur === 'number' ? dur : parseInt(String(dur), 10) || 3600;
    }
  }
  return null;
}
