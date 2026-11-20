import { apiClient } from "../lib/api.js";

export const CLINICAL_FIELDS = {
  diagnosis: [
    ["condition", "Condition", true],
    ["notes", "Notes", false],
  ],
  prescription: [
    ["medication", "Medication", true],
    ["dose", "Dose", true],
    ["directions", "Directions", false],
  ],
  laboratory: [
    ["testName", "Test", true],
    ["result", "Result", true],
    ["unit", "Unit", false],
  ],
  allergy: [
    ["substance", "Substance", true],
    ["reaction", "Reaction", false],
  ],
  treatment: [
    ["treatment", "Treatment", true],
    ["outcome", "Outcome", false],
  ],
  visit: [
    ["reason", "Reason", true],
    ["notes", "Notes", false],
  ],
};

export function clinicalRequestBody(form) {
  const fields = {};
  for (const [name] of CLINICAL_FIELDS[form.category] || []) {
    const value = form.fields?.[name]?.trim();
    if (value) fields[name] = value;
  }
  const body = {
    category: form.category,
    recordedOn: form.recordedOn,
    fields,
  };
  if (form.priorRecordId) body.priorRecordId = form.priorRecordId;
  return body;
}

export const clinicalService = {
  create(patientId, body) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/records`, { method: "POST", body });
  },
  list(patientId) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/records`);
  },
};
