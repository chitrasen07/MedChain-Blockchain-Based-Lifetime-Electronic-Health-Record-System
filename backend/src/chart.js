const MISSING = "Not recorded";
const EMERGENCY_CATEGORIES = new Set(["allergy", "diagnosis", "prescription", "laboratory"]);

const VITALS = [
  ["bloodPressure", "Blood pressure", "mmHg"],
  ["heartRate", "Heart rate", "bpm"],
  ["temperature", "Temperature", "C"],
  ["spo2", "SpO2", "%"],
  ["respiratoryRate", "Respiratory rate", "breaths/min"],
  ["weight", "Weight", "kg"],
  ["height", "Height", "cm"],
  ["bloodGlucose", "Blood glucose", "mg/dL"]
];

const AUDIT_LABELS = {
  record_created: "Record created",
  record_viewed: "Record viewed",
  record_corrected: "Record corrected",
  record_anchored: "Record anchored",
  summary_exported: "Summary exported",
  intake_created: "Nursing intake recorded",
  intake_viewed: "Nursing intake viewed",
  intake_reviewed: "Nursing intake reviewed",
  intake_rejected: "Nursing intake rejected",
  ACCESS_GRANTED: "Consent granted",
  ACCESS_REVOKED: "Consent revoked",
  ACCESS_EXPIRED: "Consent expired",
  EMERGENCY_ACCESS_GRANTED: "Emergency access used",
  EMERGENCY_ACCESS_REVOKED: "Emergency access revoked",
  EMERGENCY_ACCESS_EXPIRED: "Emergency access expired",
  EMERGENCY_PREPARED: "Emergency access prepared"
};

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function shown(value) {
  return text(value) || MISSING;
}

function sameName(left, right) {
  return text(left).toLowerCase() === text(right).toLowerCase() && text(left) !== "";
}

function ageYears(dob, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || "") || !/^\d{4}-\d{2}-\d{2}$/.test(today || "")) return null;
  const [year, month, day] = dob.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  let age = todayYear - year;
  if (todayMonth < month || (todayMonth === month && todayDay < day)) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}

function anchorStatus(record) {
  if (record?.chainStatus === "anchored") return "Anchored";
  if (record?.chainStatus === "failed" || record?.chainStatus === "mismatch") return "Failed";
  if (record?.transaction) return "Pending";
  return "Not anchored";
}

function reportStatus(record) {
  if (record?.chainStatus === "anchored") return "Anchored";
  if (record?.chainStatus === "failed" || record?.chainStatus === "mismatch") return "Failed";
  if (record?.workflowStatus === "draft") return "Draft";
  if (record?.workflowStatus === "pending_review") return "Pending Review";
  return "Reviewed";
}

function etherscanUrl(record) {
  if (anchorStatus(record) !== "Anchored") return null;
  return /^0x[0-9a-fA-F]{64}$/.test(record.transaction || "")
    ? `https://sepolia.etherscan.io/tx/${record.transaction}`
    : null;
}

function verification(record) {
  return {
    version: Number(record.versionIndex) || 0,
    storage: "Encrypted",
    contentHash: record.contentHash || MISSING,
    anchorStatus: anchorStatus(record),
    reportStatus: reportStatus(record),
    author: record.authorName || null,
    createdAt: record.createdAt || null,
    correctionReason: record.correctionReason || null,
    transaction: record.transaction || null,
    etherscanUrl: etherscanUrl(record)
  };
}

function latestByRef(records) {
  const map = new Map();
  for (const record of records) {
    const key = record.recordRef || record.id;
    const current = map.get(key);
    if (!current || Number(record.versionIndex) > Number(current.versionIndex)) map.set(key, record);
  }
  return [...map.values()];
}

function byDate(left, right) {
  return String(left.recordedOn || left.createdAt || "").localeCompare(String(right.recordedOn || right.createdAt || ""))
    || Number(left.versionIndex || 0) - Number(right.versionIndex || 0);
}

function primaryText(record) {
  const content = record.content || {};
  const fields = {
    diagnosis: ["condition"],
    prescription: ["medication", "dose"],
    laboratory: ["testName", "result", "unit"],
    allergy: ["substance", "reaction"],
    treatment: ["treatment"],
    visit: ["reason"],
    vital: VITALS.map(([key]) => key)
  }[record.category] || [];
  return fields.map((key) => text(content[key])).filter(Boolean).join(" · ") || MISSING;
}

function mergeProfile(profile, notes) {
  const next = { ...(profile || {}) };
  const ordered = [...(notes || [])].sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  for (const note of ordered) {
    if (text(note.gender)) next.gender = text(note.gender);
    if (text(note.bloodGroup)) next.bloodGroup = text(note.bloodGroup);
  }
  return next;
}

function visibleRecords(records, access) {
  if (access !== "emergency") return records;
  return records.filter((record) => EMERGENCY_CATEGORIES.has(record.category));
}

function allergyList(records) {
  return latestByRef(records.filter((record) => record.category === "allergy")).map((record) => ({
    id: record.id,
    substance: text(record.content?.substance),
    reaction: text(record.content?.reaction) || MISSING,
    recordedOn: record.recordedOn,
    author: record.authorName || MISSING
  })).filter((item) => item.substance);
}

function allergyAlerts(allergies, medication) {
  const target = text(medication);
  if (!target) return [];
  return allergies.filter((item) => sameName(item.substance, target)).map((item) => ({
    substance: item.substance,
    reaction: item.reaction || MISSING,
    message: `Recorded allergy matches this medication exactly: ${item.substance}. This is not a drug-interaction check.`
  }));
}

function prescriptionView(record, today) {
  const end = text(record.content?.endDate);
  return {
    id: record.id,
    medication: shown(record.content?.medication),
    dosage: shown(record.content?.dosage || record.content?.dose),
    frequency: shown(record.content?.frequency),
    route: shown(record.content?.route),
    duration: shown(record.content?.duration),
    instructions: shown(record.content?.instructions || record.content?.directions),
    startDate: shown(record.content?.startDate || record.recordedOn),
    endDate: end || MISSING,
    active: !end || end >= today,
    recordedOn: record.recordedOn,
    author: record.authorName || MISSING,
    alerts: allergyAlerts(allergyList([]), ""),
    verification: verification(record)
  };
}

function numericPoint(raw) {
  const value = text(raw);
  if (/^\d+(\.\d+)?$/.test(value)) return { value: Number(value) };
  const pressure = value.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!pressure) return null;
  return { systolic: Number(pressure[1]), diastolic: Number(pressure[2]) };
}

function vitalSeries(records) {
  return VITALS.map(([key, label, standardUnit]) => {
    const points = records
      .filter((record) => record.category === "vital" && text(record.content?.[key]))
      .sort(byDate)
      .map((record) => {
        const value = text(record.content[key]);
        return {
          id: record.id,
          recordedOn: record.recordedOn,
          value,
          unit: text(record.content?.[`${key}Unit`]) || standardUnit,
          chart: numericPoint(value)
        };
      });
    return { key, label, points };
  }).filter((series) => series.points.length);
}

function labTrends(results) {
  const groups = new Map();
  for (const result of results) {
    const name = text(result.testName).toLowerCase();
    const unit = text(result.unit);
    const point = numericPoint(result.result);
    if (!name || !point?.value && point?.value !== 0) continue;
    if (point.systolic != null) continue;
    const key = `${name}|${unit}`;
    const group = groups.get(key) || { testName: result.testName, unit: unit || MISSING, points: [] };
    group.points.push({ recordedOn: result.recordedOn, result: point.value, id: result.id });
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.points.length > 1);
}

function consentView(permissions, history, doctors) {
  return (permissions || []).map((permission) => {
    const wallet = String(permission.wallet || "");
    const doctor = (doctors || []).find((item) => String(item.walletAddress || "").toLowerCase() === wallet.toLowerCase());
    const events = (history || []).filter((item) => String(item.wallet || "").toLowerCase() === wallet.toLowerCase());
    return {
      doctorName: doctor?.name || MISSING,
      wallet,
      status: permission.status || (permission.active ? "active" : "revoked"),
      active: Boolean(permission.active),
      expiresAt: permission.expiresAt ?? null,
      events: events.map((item) => ({
        action: item.action,
        transaction: /^0x[0-9a-fA-F]{64}$/.test(item.transaction || "") ? item.transaction : null,
        etherscanUrl: /^0x[0-9a-fA-F]{64}$/.test(item.transaction || "")
          ? `https://sepolia.etherscan.io/tx/${item.transaction}`
          : null
      }))
    };
  });
}

function auditView(events) {
  return (events || []).flatMap((event) => {
    const label = AUDIT_LABELS[event.action] || "";
    if (!label) return [];
    return [{
      action: label,
      actor: event.actor || event.actorRole || MISSING,
      at: event.at || null,
      category: event.category || null,
      version: Number.isInteger(event.version) ? event.version : null,
      transaction: /^0x[0-9a-fA-F]{64}$/.test(event.transaction || "") ? event.transaction : null,
      source: event.source || "hospital"
    }];
  });
}

function emergencyCard(patientId) {
  if (!/^PATIENT-[0-9]{1,12}$/.test(patientId || "")) {
    const error = new Error("Patient not found");
    error.statusCode = 404;
    throw error;
  }
  return {
    patientId,
    lookupPath: `/doctor/lookup?patientId=${encodeURIComponent(patientId)}`,
    containsClinicalData: false,
    notice: "This card contains only the lifetime patient ID. Scanning it does not open the medical record."
  };
}

function buildPatientChart({
  profile,
  profileNotes,
  patientId,
  patientRef,
  records,
  visits,
  permissions,
  consentHistory,
  doctors,
  audit,
  today,
  access
}) {
  const visible = visibleRecords(records || [], access);
  const demographics = access === "emergency"
    ? { fullName: profile?.fullName, dateOfBirth: profile?.dateOfBirth, gender: profile?.gender, bloodGroup: profile?.bloodGroup }
    : mergeProfile(profile, profileNotes);
  const current = latestByRef(visible);
  const allergies = allergyList(visible);
  const diagnoses = current.filter((record) => record.category === "diagnosis").sort(byDate);
  const flagged = (status) => diagnoses
    .filter((record) => text(record.content?.status).toLowerCase() === status)
    .map((record) => text(record.content?.condition))
    .filter(Boolean);
  const chronic = diagnoses
    .filter((record) => text(record.content?.chronic).toLowerCase() === "yes")
    .map((record) => text(record.content?.condition))
    .filter(Boolean);
  const treatments = current.filter((record) => record.category === "treatment");
  const prescriptions = current
    .filter((record) => record.category === "prescription")
    .map((record) => {
      const view = prescriptionView(record, today);
      view.alerts = allergyAlerts(allergies, record.content?.medication);
      return view;
    });
  const labs = current.filter((record) => record.category === "laboratory").map((record) => ({
    id: record.id,
    testName: shown(record.content?.testName),
    result: shown(record.content?.result),
    unit: text(record.content?.unit) || MISSING,
    referenceRange: text(record.content?.referenceRange) || MISSING,
    collectedOn: text(record.content?.collectedOn) || MISSING,
    resultDate: text(record.content?.resultDate) || record.recordedOn || MISSING,
    notes: text(record.content?.notes) || MISSING,
    recordedOn: record.recordedOn,
    author: record.authorName || MISSING,
    verification: verification(record)
  }));
  const visitRecords = access === "emergency" ? [] : (records || []).filter((record) => record.category === "visit");
  const visitRefs = access === "emergency" ? [] : (visits || []);
  const lastRecordedVisit = [...visitRecords].sort(byDate).at(-1);
  const lastReference = [...visitRefs].sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || ""))).at(-1);
  const newest = [...visible].sort((left, right) => String(left.createdAt || left.recordedOn || "").localeCompare(String(right.createdAt || right.recordedOn || ""))).at(-1);
  const timeline = [
    ...visible.map((record) => ({
      id: record.id,
      at: record.recordedOn,
      category: record.category,
      title: primaryText(record),
      clinician: record.authorName || MISSING,
      version: Number(record.versionIndex) || 0,
      correction: Number(record.versionIndex) > 0,
      anchorStatus: anchorStatus(record),
      transaction: record.transaction || null,
      etherscanUrl: etherscanUrl(record)
    })),
    ...visitRefs.map((visit) => ({
      id: visit.id,
      at: visit.createdAt,
      category: "visit",
      title: "Hospital visit reference",
      clinician: MISSING,
      version: 0,
      correction: false,
      anchorStatus: "Not anchored",
      transaction: null,
      etherscanUrl: null
    }))
  ].sort((left, right) => String(right.at || "").localeCompare(String(left.at || "")));

  const versions = [...new Map((access === "emergency" ? visible : records).map((record) => [record.recordRef || record.id, null])).keys()]
    .map((ref) => {
      const group = (access === "emergency" ? visible : records).filter((record) => (record.recordRef || record.id) === ref).sort(byDate);
      return {
        recordRef: ref,
        category: group[0]?.category || MISSING,
        versions: group.map((record) => ({
          id: record.id,
          version: Number(record.versionIndex) || 0,
          recordedOn: record.recordedOn,
          author: record.authorName || MISSING,
          createdAt: record.createdAt || null,
          correctionReason: record.correctionReason || null,
          anchorStatus: anchorStatus(record),
          reportStatus: reportStatus(record),
          transaction: record.transaction || null,
          etherscanUrl: etherscanUrl(record),
          storage: "Encrypted"
        }))
      };
    });

  return {
    access,
    patientId,
    summary: {
      fullName: shown(demographics.fullName),
      age: ageYears(demographics.dateOfBirth, today),
      dateOfBirth: shown(demographics.dateOfBirth),
      gender: shown(demographics.gender),
      bloodGroup: shown(demographics.bloodGroup),
      patientId,
      did: patientRef || MISSING,
      allergies: allergies.map((item) => item.substance),
      allergyDetails: allergies,
      chronicConditions: chronic,
      currentDiseases: flagged("current"),
      latestDiagnosis: shown(diagnoses.at(-1)?.content?.condition),
      currentMedications: prescriptions.filter((item) => item.active).map((item) => item.medication),
      pastDiseases: flagged("past"),
      surgeries: treatments.filter((record) => text(record.content?.kind).toLowerCase() === "surgery").map((record) => text(record.content?.treatment)).filter(Boolean),
      treatments: treatments.map((record) => text(record.content?.treatment)).filter(Boolean),
      lastVisit: lastRecordedVisit?.recordedOn || (lastReference?.createdAt ? String(lastReference.createdAt).slice(0, 10) : null) || MISSING,
      latestUpdate: newest ? {
        category: newest.category,
        recordedOn: newest.recordedOn || MISSING,
        summary: primaryText(newest),
        anchorStatus: anchorStatus(newest)
      } : null
    },
    timeline,
    vitals: access === "emergency" ? [] : vitalSeries(records || []),
    prescriptions: {
      active: prescriptions.filter((item) => item.active),
      historical: prescriptions.filter((item) => !item.active)
    },
    labs: {
      results: labs,
      trends: labTrends(labs.filter((item) => item.result !== MISSING).map((item) => ({
        ...item,
        testName: item.testName,
        result: item.result,
        unit: item.unit === MISSING ? "" : item.unit
      })))
    },
    visits: access === "emergency" ? [] : [
      ...visitRecords.map((record) => ({
        id: record.id,
        recordedOn: record.recordedOn,
        reason: shown(record.content?.reason),
        notes: shown(record.content?.notes),
        author: record.authorName || MISSING,
        verification: verification(record)
      })),
      ...visitRefs.map((visit) => ({
        id: visit.id,
        recordedOn: visit.createdAt ? String(visit.createdAt).slice(0, 10) : MISSING,
        reason: "Hospital visit reference",
        notes: MISSING,
        author: MISSING,
        verification: null
      }))
    ],
    consent: access === "emergency" ? [] : consentView(permissions, consentHistory, doctors),
    blockchain: visible.map((record) => ({
      id: record.id,
      category: record.category,
      recordedOn: record.recordedOn,
      ...verification(record)
    })),
    versions,
    audit: access === "emergency" ? auditView(audit).filter((item) => item.action === "Emergency access used" || item.action === "Emergency access prepared") : auditView(audit)
  };
}

module.exports = {
  MISSING,
  VITALS,
  ageYears,
  anchorStatus,
  reportStatus,
  allergyAlerts,
  buildPatientChart,
  emergencyCard,
  mergeProfile,
  numericPoint,
  verification,
  visibleRecords
};
