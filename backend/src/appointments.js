const { z } = require("zod");
const { encryptJson, decryptJson, requiredKey } = require("./crypto");
const { requireAuth, requirePatient } = require("./auth");

const HOSPITAL_ZONE = "Asia/Kolkata";
const DURATIONS = [15, 30, 45, 60];
const ACTIVE = ["confirmed", "rescheduled"];
const MESSAGES = {
  details: "Check the appointment details and try again.",
  future: "Choose a future appointment date and time.",
  doctor: "Choose a doctor at this hospital.",
  verified: "A verified doctor account is required.",
  duplicate: "An appointment request for this doctor and time is already pending.",
  overlap: "This doctor already has an appointment at that time.",
  transition: "This appointment can no longer be changed.",
  missing: "Appointment not found."
};

const whenSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/)
});
const requestSchema = whenSchema.extend({
  doctorId: z.string().uuid(),
  reason: z.string().trim().max(500).optional()
});
const scheduleSchema = whenSchema.extend({
  durationMinutes: z.coerce.number().refine((value) => DURATIONS.includes(value)),
  department: z.string().trim().max(80).optional(),
  room: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional()
});
const rejectSchema = z.object({
  reason: z.string().trim().max(500).optional()
});

function fail(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function blank(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function zoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(instant);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const wall = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour) % 24, Number(map.minute), Number(map.second));
  return wall - instant.getTime();
}

function wallClockToUtc(date, time, timeZone = HOSPITAL_ZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  const clock = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!match || !clock) throw fail(MESSAGES.details, 400);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) throw fail(MESSAGES.details, 400);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const utc = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  const back = wallClockInputs(utc, timeZone);
  if (back.date !== date || back.time !== time) throw fail(MESSAGES.details, 400);
  return utc;
}

function wallClockInputs(instant, timeZone = HOSPITAL_ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date(instant));
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const hour = String(Number(map.hour) % 24).padStart(2, "0");
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${hour}:${map.minute}` };
}

function displayParts(instant, timeZone = HOSPITAL_ZONE) {
  if (!instant) return { date: null, time: null };
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short", year: "numeric" }).format(new Date(instant));
  const clock = wallClockInputs(instant, timeZone);
  return { date, time: clock.time };
}

function dateKey(instant, timeZone = HOSPITAL_ZONE) {
  return wallClockInputs(instant, timeZone).date;
}

function bookingConflict(rows, start, end, exceptId) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return rows.some((row) => {
    if (!row || row.id === exceptId) return false;
    if (!ACTIVE.includes(row.status) || !row.confirmedStart || !row.confirmedEnd) return false;
    return new Date(row.confirmedStart).getTime() < endMs && new Date(row.confirmedEnd).getTime() > startMs;
  });
}

function hiddenText(ciphertext, key) {
  if (!ciphertext) return null;
  const value = decryptJson(ciphertext, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function patientName(ciphertext, key) {
  if (!ciphertext) return null;
  try {
    const profile = decryptJson(ciphertext, key);
    return typeof profile?.fullName === "string" && profile.fullName.trim() ? profile.fullName.trim() : null;
  } catch {
    return null;
  }
}

function presentAppointment(row, key, { includePatientName = false } = {}) {
  const zone = row.timezone || HOSPITAL_ZONE;
  const requested = displayParts(row.requestedStart, zone);
  const confirmed = displayParts(row.confirmedStart, zone);
  const confirmedEnd = displayParts(row.confirmedEnd, zone);
  const requestedInput = wallClockInputs(row.requestedStart, zone);
  const confirmedInput = row.confirmedStart ? wallClockInputs(row.confirmedStart, zone) : { date: null, time: null };
  return {
    id: row.id,
    status: row.status,
    patientId: row.publicPatientId,
    patientName: includePatientName ? patientName(row.patientCiphertext, key) : undefined,
    doctorId: row.doctorId,
    doctorName: row.doctorName || "Doctor",
    hospitalName: row.hospitalName,
    specialization: row.specialization || null,
    requestedStart: new Date(row.requestedStart).toISOString(),
    requestedDate: requested.date,
    requestedTime: requested.time,
    requestedDateInput: requestedInput.date,
    requestedTimeInput: requestedInput.time,
    confirmedStart: row.confirmedStart ? new Date(row.confirmedStart).toISOString() : null,
    confirmedEnd: row.confirmedEnd ? new Date(row.confirmedEnd).toISOString() : null,
    confirmedDate: confirmed.date,
    confirmedTime: confirmed.time,
    confirmedEndTime: confirmedEnd.time,
    confirmedDateInput: confirmedInput.date,
    confirmedTimeInput: confirmedInput.time,
    durationMinutes: row.durationMinutes || null,
    timezone: zone,
    reason: hiddenText(row.reasonCiphertext, key),
    doctorNotes: hiddenText(row.notesCiphertext, key),
    rejectionReason: hiddenText(row.rejectionCiphertext, key),
    department: row.department || null,
    room: row.room || null,
    visitReference: row.visitReference || null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
  };
}

function groupForDoctor(items, now = new Date()) {
  const pending = [];
  const today = [];
  const upcoming = [];
  const completed = [];
  const todayKey = dateKey(now, HOSPITAL_ZONE);
  for (const item of items) {
    if (item.status === "pending") pending.push(item);
    else if (item.status === "completed") completed.push(item);
    else if (ACTIVE.includes(item.status) && item.confirmedStart) {
      const key = dateKey(item.confirmedStart, item.timezone || HOSPITAL_ZONE);
      if (key === todayKey) today.push(item);
      else if (new Date(item.confirmedStart).getTime() > now.getTime()) upcoming.push(item);
    }
  }
  const byStart = (left, right) => new Date(left.confirmedStart) - new Date(right.confirmedStart);
  today.sort(byStart);
  upcoming.sort(byStart);
  return { pending, today, upcoming, completed, history: items };
}

function nextVisit(items, now = new Date()) {
  return items
    .filter((item) => ACTIVE.includes(item.status) && item.confirmedStart && new Date(item.confirmedStart).getTime() >= now.getTime())
    .sort((left, right) => new Date(left.confirmedStart) - new Date(right.confirmedStart))[0] || null;
}

const ROW_SQL = `
  SELECT a.id,
    a.hospital_id AS "hospitalId",
    a.patient_id AS "patientId",
    p.patient_id AS "publicPatientId",
    p.pii_ciphertext AS "patientCiphertext",
    a.doctor_id AS "doctorId",
    u.full_name AS "doctorName",
    h.name AS "hospitalName",
    (SELECT specialization FROM doctor_profiles WHERE user_id = a.doctor_id) AS specialization,
    a.requested_start AS "requestedStart",
    a.confirmed_start AS "confirmedStart",
    a.confirmed_end AS "confirmedEnd",
    a.duration_minutes AS "durationMinutes",
    a.timezone,
    a.reason_ciphertext AS "reasonCiphertext",
    a.notes_ciphertext AS "notesCiphertext",
    a.rejection_ciphertext AS "rejectionCiphertext",
    a.department,
    a.room,
    a.status,
    a.created_at AS "createdAt",
    a.updated_at AS "updatedAt",
    v.record_reference AS "visitReference"
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN users u ON u.id = a.doctor_id
  JOIN hospitals h ON h.id = a.hospital_id
  LEFT JOIN visits v ON v.record_reference = ('appointment:' || a.id::text)
`;

function createPgAppointmentStore(db) {
  async function readJoined(client, id) {
    const result = await client.query(`${ROW_SQL} WHERE a.id = $1`, [id]);
    return result.rows[0] || null;
  }

  return {
    async listDoctors(hospitalId) {
      const result = await db.query(
        `SELECT u.id, u.full_name AS "fullName", h.name AS "hospitalName",
            p.specialization, p.department, p.experience_years AS "experienceYears",
            p.designation, p.languages, p.consultation_hours AS "consultationHours", p.biography,
            COALESCE(p.status, 'incomplete') AS "verificationStatus",
            (p.photo_key IS NOT NULL) AS "photoAvailable",
            (SELECT string_agg(q.degree, ', ' ORDER BY q.position) FROM doctor_qualifications q WHERE q.user_id = u.id) AS degrees
         FROM users u
         JOIN hospitals h ON h.id = u.hospital_id
         JOIN staff_chain_authorizations s ON s.user_id = u.id
         LEFT JOIN doctor_profiles p ON p.user_id = u.id
         WHERE u.hospital_id = $1 AND u.role = 'doctor' AND u.status = 'active' AND h.status = 'active'
           AND s.status = 'active' AND s.action = 'grant' AND s.chain_role = 'DOCTOR' AND s.wallet_address IS NOT NULL
         ORDER BY u.full_name NULLS LAST, u.created_at`,
        [hospitalId]
      );
      return result.rows;
    },
    async doctorIsVerified(doctorId, hospitalId) {
      const result = await db.query(
        `SELECT 1 FROM users u
         JOIN staff_chain_authorizations s ON s.user_id = u.id
         WHERE u.id = $1 AND u.hospital_id = $2 AND u.role = 'doctor' AND u.status = 'active'
           AND s.status = 'active' AND s.action = 'grant' AND s.chain_role = 'DOCTOR' AND s.wallet_address IS NOT NULL`,
        [doctorId, hospitalId]
      );
      return result.rowCount > 0;
    },
    async createPending(input) {
      return db.transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [input.doctorId]);
        const doctor = await client.query(
          `SELECT u.id, u.full_name AS "doctorName", h.name AS "hospitalName"
           FROM users u
           JOIN hospitals h ON h.id = u.hospital_id
           JOIN staff_chain_authorizations s ON s.user_id = u.id
           WHERE u.id = $1 AND u.hospital_id = $2 AND u.role = 'doctor' AND u.status = 'active' AND h.status = 'active'
             AND s.status = 'active' AND s.action = 'grant' AND s.chain_role = 'DOCTOR' AND s.wallet_address IS NOT NULL`,
          [input.doctorId, input.hospitalId]
        );
        if (!doctor.rows[0]) throw fail(MESSAGES.doctor, 400);
        const existing = await client.query(
          `SELECT id, patient_id AS "patientId", doctor_id AS "doctorId", requested_start AS "requestedStart", status
           FROM appointments
           WHERE doctor_id = $1 AND status = 'pending'
           FOR UPDATE`,
          [input.doctorId]
        );
        const duplicate = existing.rows.some((row) => row.patientId === input.patientId && new Date(row.requestedStart).getTime() === input.requestedStart.getTime());
        if (duplicate) throw fail(MESSAGES.duplicate, 409);
        const inserted = await client.query(
          `INSERT INTO appointments (
             hospital_id, patient_id, doctor_id, requested_start, timezone, reason_ciphertext, status
           ) VALUES ($1,$2,$3,$4,$5,$6,'pending')
           RETURNING id`,
          [input.hospitalId, input.patientId, input.doctorId, input.requestedStart, HOSPITAL_ZONE, input.reasonCiphertext]
        );
        await client.query(
          `INSERT INTO audit_events (
             actor_id, actor_role, actor_label, hospital_id, patient_id, action, category, outcome, resource_id, metadata
           ) VALUES ($1,'patient',$2,$3,$4,'APPOINTMENT_REQUESTED','appointment','success',$5,$6::jsonb)`,
          [null, input.publicPatientId || null, input.hospitalId, input.patientId, inserted.rows[0].id, JSON.stringify({ doctorId: input.doctorId })]
        );
        return readJoined(client, inserted.rows[0].id);
      }).catch(mapAppointmentError);
    },
    async listByPatient(patientId, hospitalId) {
      const result = await db.query(`${ROW_SQL} WHERE a.patient_id = $1 AND a.hospital_id = $2 ORDER BY a.updated_at DESC`, [patientId, hospitalId]);
      return result.rows;
    },
    async listByDoctor(doctorId, hospitalId) {
      const result = await db.query(`${ROW_SQL} WHERE a.doctor_id = $1 AND a.hospital_id = $2 ORDER BY a.updated_at DESC`, [doctorId, hospitalId]);
      return result.rows;
    },
    async transition(input) {
      return db.transaction(async (client) => {
        const located = await client.query(
          "SELECT id, doctor_id FROM appointments WHERE id = $1 AND hospital_id = $2",
          [input.id, input.hospitalId]
        );
        if (!located.rows[0]) return null;
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [located.rows[0].doctor_id]);
        const current = await client.query(
          `SELECT id, patient_id AS "patientId", doctor_id AS "doctorId", status,
                  confirmed_start AS "confirmedStart", confirmed_end AS "confirmedEnd"
           FROM appointments WHERE id = $1 AND hospital_id = $2 FOR UPDATE`,
          [input.id, input.hospitalId]
        );
        const row = current.rows[0];
        if (!row) return null;
        if (input.patientId && row.patientId !== input.patientId) return null;
        if (input.doctorId && row.doctorId !== input.doctorId) return null;
        if (!input.from.includes(row.status)) throw fail(MESSAGES.transition, 409);
        if (input.confirmedStart && input.confirmedEnd) {
          const booked = await client.query(
            `SELECT id, status, confirmed_start AS "confirmedStart", confirmed_end AS "confirmedEnd"
             FROM appointments
             WHERE doctor_id = $1 AND status IN ('confirmed', 'rescheduled') AND id <> $2
             FOR UPDATE`,
            [row.doctorId, row.id]
          );
          if (bookingConflict(booked.rows, input.confirmedStart, input.confirmedEnd, row.id)) throw fail(MESSAGES.overlap, 409);
        }
        await client.query(
          `UPDATE appointments
           SET status = $2,
               confirmed_start = COALESCE($3, confirmed_start),
               confirmed_end = COALESCE($4, confirmed_end),
               duration_minutes = COALESCE($5, duration_minutes),
               department = COALESCE($6, department),
               room = COALESCE($7, room),
               notes_ciphertext = COALESCE($8, notes_ciphertext),
               rejection_ciphertext = COALESCE($9, rejection_ciphertext),
               updated_at = now()
           WHERE id = $1`,
          [
            row.id,
            input.status,
            input.confirmedStart || null,
            input.confirmedEnd || null,
            input.durationMinutes || null,
            input.department || null,
            input.room || null,
            input.notesCiphertext || null,
            input.rejectionCiphertext || null
          ]
        );
        if (input.status === "completed") {
          await client.query(
            `INSERT INTO visits (patient_id, record_reference, created_by, hospital_id)
             SELECT $1, $2, $3, $4
             WHERE NOT EXISTS (SELECT 1 FROM visits WHERE record_reference = $2)`,
            [row.patientId, `appointment:${row.id}`, row.doctorId, input.hospitalId]
          );
        }
        await client.query(
          `INSERT INTO audit_events (
             actor_id, actor_role, hospital_id, patient_id, action, category, outcome, resource_id, metadata
           ) VALUES ($1,$2,$3,$4,$5,'appointment','success',$6,$7::jsonb)`,
          [input.actorId || null, input.actorRole || null, input.hospitalId, row.patientId, input.action, row.id, JSON.stringify({ status: input.status })]
        );
        return readJoined(client, row.id);
      }).catch(mapAppointmentError);
    }
  };
}

function mapAppointmentError(error) {
  if (error?.code === "23505" && error.constraint === "appointments_one_pending_request") {
    throw fail(MESSAGES.duplicate, 409);
  }
  throw error;
}

function createMemoryAppointmentStore() {
  const doctors = [];
  const rows = [];
  const audits = [];
  const visits = [];
  const tails = new Map();
  let sequence = 0;

  function lock(key, fn) {
    const previous = tails.get(key) || Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    tails.set(key, run);
    return run;
  }

  function joined(row) {
    const doctor = doctors.find((item) => item.id === row.doctorId);
    return {
      ...row,
      doctorName: doctor?.fullName || "Doctor",
      hospitalName: doctor?.hospitalName || row.hospitalName,
      specialization: doctor?.specialization || null,
      visitReference: visits.find((visit) => visit.recordReference === `appointment:${row.id}`)?.recordReference || null
    };
  }

  return {
    doctors,
    rows,
    audits,
    visits,
    seedDoctor(doctor) { doctors.push(doctor); },
    async listDoctors(hospitalId) {
      return doctors
        .filter((doctor) => doctor.hospitalId === hospitalId && doctor.verified)
        .map((doctor) => ({
          id: doctor.id,
          fullName: doctor.fullName,
          hospitalName: doctor.hospitalName,
          specialization: doctor.specialization || null,
          department: doctor.department || null,
          experienceYears: Number.isInteger(doctor.experienceYears) ? doctor.experienceYears : null,
          designation: doctor.designation || null,
          languages: doctor.languages || null,
          consultationHours: doctor.consultationHours || null,
          biography: doctor.biography || null,
          degrees: doctor.degrees || null,
          verificationStatus: doctor.verificationStatus || "incomplete",
          photoAvailable: Boolean(doctor.photoAvailable)
        }));
    },
    async doctorIsVerified(doctorId, hospitalId) {
      return doctors.some((doctor) => doctor.id === doctorId && doctor.hospitalId === hospitalId && doctor.verified);
    },
    async createPending(input) {
      return lock(input.doctorId, async () => {
        const doctor = doctors.find((item) => item.id === input.doctorId && item.hospitalId === input.hospitalId && item.verified);
        if (!doctor) throw fail(MESSAGES.doctor, 400);
        const duplicate = rows.some((row) => row.status === "pending" && row.patientId === input.patientId && row.doctorId === input.doctorId && new Date(row.requestedStart).getTime() === input.requestedStart.getTime());
        if (duplicate) throw fail(MESSAGES.duplicate, 409);
        sequence += 1;
        const row = {
          id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          hospitalId: input.hospitalId,
          patientId: input.patientId,
          publicPatientId: input.publicPatientId,
          patientCiphertext: input.patientCiphertext,
          doctorId: input.doctorId,
          hospitalName: doctor.hospitalName,
          requestedStart: input.requestedStart,
          confirmedStart: null,
          confirmedEnd: null,
          durationMinutes: null,
          timezone: HOSPITAL_ZONE,
          reasonCiphertext: input.reasonCiphertext,
          notesCiphertext: null,
          rejectionCiphertext: null,
          department: null,
          room: null,
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date()
        };
        rows.push(row);
        audits.push({ actorId: null, action: "APPOINTMENT_REQUESTED", resourceId: row.id });
        return joined(row);
      });
    },
    async listByPatient(patientId, hospitalId) {
      return rows.filter((row) => row.patientId === patientId && row.hospitalId === hospitalId).map(joined).sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
    },
    async listByDoctor(doctorId, hospitalId) {
      return rows.filter((row) => row.doctorId === doctorId && row.hospitalId === hospitalId).map(joined).sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
    },
    async transition(input) {
      const located = rows.find((row) => row.id === input.id && row.hospitalId === input.hospitalId);
      if (!located) return null;
      return lock(located.doctorId, async () => {
        const row = rows.find((item) => item.id === input.id && item.hospitalId === input.hospitalId);
        if (!row) return null;
        if (input.patientId && row.patientId !== input.patientId) return null;
        if (input.doctorId && row.doctorId !== input.doctorId) return null;
        if (!input.from.includes(row.status)) throw fail(MESSAGES.transition, 409);
        if (input.confirmedStart && input.confirmedEnd && bookingConflict(rows, input.confirmedStart, input.confirmedEnd, row.id)) {
          throw fail(MESSAGES.overlap, 409);
        }
        row.status = input.status;
        if (input.confirmedStart) row.confirmedStart = input.confirmedStart;
        if (input.confirmedEnd) row.confirmedEnd = input.confirmedEnd;
        if (input.durationMinutes) row.durationMinutes = input.durationMinutes;
        if (input.department) row.department = input.department;
        if (input.room) row.room = input.room;
        if (input.notesCiphertext) row.notesCiphertext = input.notesCiphertext;
        if (input.rejectionCiphertext) row.rejectionCiphertext = input.rejectionCiphertext;
        row.updatedAt = new Date();
        if (input.status === "completed" && !visits.some((visit) => visit.recordReference === `appointment:${row.id}`)) {
          visits.push({ patientId: row.patientId, recordReference: `appointment:${row.id}`, createdBy: row.doctorId, hospitalId: input.hospitalId });
        }
        audits.push({ actorId: input.actorId || null, action: input.action, resourceId: row.id, status: input.status });
        return joined(row);
      });
    }
  };
}

function parse(schema, body) {
  const parsed = schema.safeParse(body || {});
  if (!parsed.success) throw fail(MESSAGES.details, 400);
  return parsed.data;
}

function futureSlot(date, time) {
  const start = wallClockToUtc(date, String(time).slice(0, 5), HOSPITAL_ZONE);
  if (start.getTime() <= Date.now()) throw fail(MESSAGES.future, 400);
  return start;
}

function registerAppointments(app, { db, config = {}, store } = {}) {
  const appointments = store || createPgAppointmentStore(db);
  const key = () => requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);
  const patient = requirePatient(config.jwtSecret, { loadPatient: (id) => db.getPatientForAuth(id) });
  const doctor = requireAuth(config.jwtSecret, ["doctor"], { loadUser: (id) => db.getUserForAuth(id) });

  async function verifiedDoctor(user) {
    if (!(await appointments.doctorIsVerified(user.id, user.hospital_id))) throw fail(MESSAGES.verified, 403);
  }

  function show(row, viewer) {
    if (!row) return null;
    const view = presentAppointment(row, key(), { includePatientName: viewer === "doctor" });
    if (viewer === "patient") delete view.patientName;
    return view;
  }

  app.get("/patient-portal/appointments/doctors", patient, async (req, res, next) => {
    try {
      const doctors = await appointments.listDoctors(req.patient.hospital_id);
      const needle = String(req.query.q || "").trim().toLowerCase();
      const matches = doctors.filter((item) => {
        if (!needle) return true;
        const name = String(item.fullName || "").toLowerCase();
        const specialty = String(item.specialization || "").toLowerCase();
        return name.includes(needle) || (specialty && specialty.includes(needle));
      });
      res.json({
        timezone: HOSPITAL_ZONE,
        doctors: matches.map((item) => ({
          id: item.id,
          fullName: item.fullName || "Doctor",
          hospitalName: item.hospitalName,
          specialization: item.specialization || null,
          department: item.department || null,
          experienceYears: Number.isInteger(Number(item.experienceYears)) && item.experienceYears !== null && item.experienceYears !== "" ? Number(item.experienceYears) : null,
          designation: item.designation || null,
          languages: item.languages || null,
          consultationHours: item.consultationHours || null,
          biography: item.biography || null,
          degrees: item.degrees || null,
          verificationStatus: item.verificationStatus || "incomplete",
          photoAvailable: Boolean(item.photoAvailable),
          availability: item.consultationHours || null
        }))
      });
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/appointments", patient, async (req, res, next) => {
    try {
      const rows = await appointments.listByPatient(req.patient.id, req.patient.hospital_id);
      const items = rows.map((row) => show(row, "patient"));
      res.json({ timezone: HOSPITAL_ZONE, appointments: items, upcoming: nextVisit(items) });
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/appointments/:id", patient, async (req, res, next) => {
    try {
      const rows = await appointments.listByPatient(req.patient.id, req.patient.hospital_id);
      const row = rows.find((item) => item.id === req.params.id);
      if (!row) return res.status(404).json({ error: MESSAGES.missing });
      res.json({ appointment: show(row, "patient") });
    } catch (error) { next(error); }
  });

  app.post("/patient-portal/appointments", patient, async (req, res, next) => {
    try {
      const body = parse(requestSchema, req.body);
      const requestedStart = futureSlot(body.date, body.time);
      const row = await appointments.createPending({
        hospitalId: req.patient.hospital_id,
        patientId: req.patient.id,
        publicPatientId: req.patient.patientId,
        patientCiphertext: req.patient.piiCiphertext || req.patient.pii_ciphertext || null,
        doctorId: body.doctorId,
        requestedStart,
        reasonCiphertext: blank(body.reason) ? encryptJson(blank(body.reason), key()) : null
      });
      res.status(201).json({ appointment: show(row, "patient"), message: "The appointment request was submitted." });
    } catch (error) { next(error); }
  });

  app.post("/patient-portal/appointments/:id/cancel", patient, async (req, res, next) => {
    try {
      const row = await appointments.transition({
        id: req.params.id,
        hospitalId: req.patient.hospital_id,
        patientId: req.patient.id,
        from: ["pending", "confirmed", "rescheduled"],
        status: "cancelled",
        action: "APPOINTMENT_CANCELLED",
        actorId: null
      });
      if (!row) return res.status(404).json({ error: MESSAGES.missing });
      res.json({ appointment: show(row, "patient") });
    } catch (error) { next(error); }
  });

  app.get("/doctor/appointments", doctor, async (req, res, next) => {
    try {
      await verifiedDoctor(req.user);
      const rows = await appointments.listByDoctor(req.user.id, req.user.hospital_id);
      const items = rows.map((row) => show(row, "doctor"));
      res.json({ timezone: HOSPITAL_ZONE, ...groupForDoctor(items), appointments: items });
    } catch (error) { next(error); }
  });

  app.get("/doctor/appointments/:id", doctor, async (req, res, next) => {
    try {
      await verifiedDoctor(req.user);
      const rows = await appointments.listByDoctor(req.user.id, req.user.hospital_id);
      const row = rows.find((item) => item.id === req.params.id);
      if (!row) return res.status(404).json({ error: MESSAGES.missing });
      res.json({ appointment: show(row, "doctor") });
    } catch (error) { next(error); }
  });

  async function doctorChange(req, res, next, change) {
    try {
      await verifiedDoctor(req.user);
      const row = await appointments.transition({
        id: req.params.id,
        hospitalId: req.user.hospital_id,
        doctorId: req.user.id,
        actorId: req.user.id,
        actorRole: req.user.role,
        ...change()
      });
      if (!row) return res.status(404).json({ error: MESSAGES.missing });
      res.json({ appointment: show(row, "doctor") });
    } catch (error) { next(error); }
  }

  app.post("/doctor/appointments/:id/approve", doctor, (req, res, next) => doctorChange(req, res, next, () => {
    const body = parse(scheduleSchema, req.body);
    const confirmedStart = futureSlot(body.date, body.time);
    return {
      from: ["pending"],
      status: "confirmed",
      action: "APPOINTMENT_APPROVED",
      confirmedStart,
      confirmedEnd: new Date(confirmedStart.getTime() + body.durationMinutes * 60_000),
      durationMinutes: body.durationMinutes,
      department: blank(body.department),
      room: blank(body.room),
      notesCiphertext: blank(body.notes) ? encryptJson(blank(body.notes), key()) : null
    };
  }));

  app.post("/doctor/appointments/:id/reschedule", doctor, (req, res, next) => doctorChange(req, res, next, () => {
    const body = parse(scheduleSchema, req.body);
    const confirmedStart = futureSlot(body.date, body.time);
    return {
      from: ["confirmed", "rescheduled"],
      status: "rescheduled",
      action: "APPOINTMENT_RESCHEDULED",
      confirmedStart,
      confirmedEnd: new Date(confirmedStart.getTime() + body.durationMinutes * 60_000),
      durationMinutes: body.durationMinutes,
      department: blank(body.department),
      room: blank(body.room),
      notesCiphertext: blank(body.notes) ? encryptJson(blank(body.notes), key()) : null
    };
  }));

  app.post("/doctor/appointments/:id/reject", doctor, (req, res, next) => doctorChange(req, res, next, () => {
    const body = parse(rejectSchema, req.body);
    return {
      from: ["pending"],
      status: "rejected",
      action: "APPOINTMENT_REJECTED",
      rejectionCiphertext: blank(body.reason) ? encryptJson(blank(body.reason), key()) : null
    };
  }));

  app.post("/doctor/appointments/:id/complete", doctor, (req, res, next) => doctorChange(req, res, next, () => ({
    from: ["confirmed", "rescheduled"],
    status: "completed",
    action: "APPOINTMENT_COMPLETED"
  })));

  app.post("/doctor/appointments/:id/cancel", doctor, (req, res, next) => doctorChange(req, res, next, () => ({
    from: ["pending", "confirmed", "rescheduled"],
    status: "cancelled",
    action: "APPOINTMENT_CANCELLED"
  })));
}

module.exports = {
  HOSPITAL_ZONE,
  MESSAGES,
  registerAppointments,
  createMemoryAppointmentStore,
  wallClockToUtc,
  wallClockInputs,
  bookingConflict,
  presentAppointment
};
