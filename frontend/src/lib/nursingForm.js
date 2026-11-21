const VITALS = [
  ["bloodPressure", "Blood pressure", "mmHg", "120/80"],
  ["heartRate", "Pulse", "bpm", "72"],
  ["temperature", "Temperature", "C", "36.8"],
  ["spo2", "SpO2", "%", "98"],
  ["respiratoryRate", "Respiratory rate", "breaths/min", "16"],
  ["height", "Height", "cm", "170"],
  ["weight", "Weight", "kg", "65"],
];

export function vitalFields() {
  return VITALS;
}

export function nursingIssues(kind, fields, recordedOn) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedOn || "")) return "Enter the date this was recorded.";
  if (recordedOn > new Date().toISOString().slice(0, 10)) return "The recorded date cannot be in the future.";
  if (kind === "vital") return vitalIssue(fields);
  if (kind === "visit_note") return visitIssue(fields);
  if (kind === "laboratory") return labIssue(fields);
  return "Choose a nursing intake type.";
}

function trimmed(fields, name) {
  return String(fields?.[name] || "").trim();
}

function vitalIssue(fields) {
  const bloodPressure = trimmed(fields, "bloodPressure");
  const present = [];
  if (bloodPressure) {
    const match = /^(\d{2,3})\/(\d{2,3})$/.exec(bloodPressure);
    if (!match) return "Enter blood pressure as systolic/diastolic, for example 120/80.";
    const systolic = Number(match[1]);
    const diastolic = Number(match[2]);
    if (systolic < 50 || systolic > 260 || diastolic < 20 || diastolic > 200 || systolic <= diastolic) {
      return "Blood pressure is outside the accepted range.";
    }
    present.push("bloodPressure");
  }
  const checks = [
    ["heartRate", /^\d+$/, 20, 250, "Enter pulse as a whole number from 20 to 250."],
    ["temperature", /^\d+(\.\d+)?$/, 30, 45, "Enter temperature in Celsius from 30 to 45."],
    ["spo2", /^\d+$/, 50, 100, "Enter SpO2 as a whole number from 50 to 100."],
    ["respiratoryRate", /^\d+$/, 4, 80, "Enter respiratory rate as a whole number from 4 to 80."],
    ["height", /^\d+(\.\d+)?$/, 30, 250, "Enter height in centimeters from 30 to 250."],
    ["weight", /^\d+(\.\d+)?$/, 0.5, 400, "Enter weight in kilograms from 0.5 to 400."],
  ];
  for (const [name, pattern, min, max, message] of checks) {
    const value = trimmed(fields, name);
    if (!value) continue;
    const number = Number(value);
    if (!pattern.test(value) || number < min || number > max) return message;
    present.push(name);
  }
  if (!present.length) return "Enter at least one vital sign. Empty measurements are not saved.";
  const notes = trimmed(fields, "notes");
  if (notes.length > 2000) return "Notes must be 2000 characters or fewer.";
  return "";
}

function visitIssue(fields) {
  const checkInAt = trimmed(fields, "checkInAt");
  const parsed = Date.parse(checkInAt);
  if (!checkInAt || !Number.isFinite(parsed)) return "Enter the check-in time.";
  if (parsed > Date.now() + 5 * 60 * 1000) return "Check-in time cannot be in the future.";
  const reason = trimmed(fields, "reason");
  if (reason.length < 2 || reason.length > 500) return "Enter the visit reason.";
  if (trimmed(fields, "symptoms").length > 2000 || trimmed(fields, "observations").length > 2000) {
    return "Symptoms and observations must be 2000 characters or fewer.";
  }
  return "";
}

function labIssue(fields) {
  if (trimmed(fields, "testName").length < 2) return "Enter the laboratory test name.";
  if (trimmed(fields, "result").length < 1) return "Enter the laboratory result.";
  const collectedOn = trimmed(fields, "collectedOn");
  if (collectedOn && !/^\d{4}-\d{2}-\d{2}$/.test(collectedOn)) return "Enter the collection date as YYYY-MM-DD.";
  return "";
}

export function nursingBody(kind, recordedOn, fields) {
  const next = {};
  for (const [name, value] of Object.entries(fields || {})) {
    const trimmedValue = String(value || "").trim();
    if (trimmedValue) next[name] = trimmedValue;
  }
  return { kind, recordedOn, fields: next };
}
