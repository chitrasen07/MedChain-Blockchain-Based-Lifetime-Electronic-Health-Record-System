import { apiClient } from "../lib/api.js";

export const CLINICAL_FIELDS = {
  diagnosis: [
    ["condition", "Condition", true],
    ["status", "Status (current or past)", false],
    ["chronic", "Chronic (yes or no)", false],
    ["notes", "Notes", false],
  ],
  prescription: [
    ["medication", "Medication", true],
    ["dose", "Dosage", true],
    ["frequency", "Frequency", false],
    ["route", "Route", false],
    ["duration", "Duration", false],
    ["instructions", "Instructions", false],
    ["startDate", "Start date", false],
    ["endDate", "End date", false],
    ["directions", "Directions", false],
  ],
  laboratory: [
    ["testName", "Test", true],
    ["result", "Result", true],
    ["unit", "Unit", false],
    ["referenceRange", "Reference range", false],
    ["collectedOn", "Collection date", false],
    ["resultDate", "Result date", false],
    ["notes", "Clinician notes", false],
  ],
  allergy: [
    ["substance", "Substance", true],
    ["reaction", "Reaction", false],
  ],
  treatment: [
    ["treatment", "Treatment", true],
    ["kind", "Kind (surgery or treatment)", false],
    ["outcome", "Outcome", false],
  ],
  visit: [
    ["reason", "Reason", true],
    ["notes", "Notes", false],
  ],
  vital: [
    ["bloodPressure", "Blood pressure", false],
    ["bloodPressureUnit", "Blood pressure unit", false],
    ["heartRate", "Heart rate", false],
    ["heartRateUnit", "Heart rate unit", false],
    ["temperature", "Temperature", false],
    ["temperatureUnit", "Temperature unit", false],
    ["spo2", "SpO2", false],
    ["spo2Unit", "SpO2 unit", false],
    ["weight", "Weight", false],
    ["weightUnit", "Weight unit", false],
    ["height", "Height", false],
    ["heightUnit", "Height unit", false],
    ["bloodGlucose", "Blood glucose", false],
    ["bloodGlucoseUnit", "Blood glucose unit", false],
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
  async bindWallet(walletAddress, sign) {
    const challenge = await apiClient.request("/clinical-wallet/challenge", {
      method: "POST",
      body: { walletAddress },
    });
    const signature = await sign(challenge.message, walletAddress);
    return apiClient.request("/clinical-wallet/session", {
      method: "POST",
      body: { walletAddress, nonce: challenge.nonce, signature },
    });
  },
  prepareAnchor(patientId, recordId) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/records/${encodeURIComponent(recordId)}/anchor`, {
      method: "POST",
      body: {},
    });
  },
  recordAnchor(patientId, recordId, transaction) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/records/${encodeURIComponent(recordId)}/anchor-result`, {
      method: "POST",
      body: { transaction },
    });
  },
  prepareEmergency(patientId, body) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/emergency-access`, { method: "POST", body });
  },
  listEmergency(patientId) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/emergency-access`);
  },
};
