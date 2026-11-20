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
  prepareEmergency(patientId, body) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/emergency-access`, { method: "POST", body });
  },
  listEmergency(patientId) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/emergency-access`);
  },
};
