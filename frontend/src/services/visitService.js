import { apiClient } from "../lib/api.js";

const hashPattern = /^0x[0-9a-fA-F]{64}$/;

export function validateVisit(input) {
  const errors = {};
  const patientId = input.patientId.trim();
  const recordReference = input.recordReference.trim();
  const recordHash = input.recordHash.trim();
  if (!patientId || patientId.length > 100) errors.patientId = "Enter the patient ID.";
  if (!recordReference || recordReference.length > 200) errors.recordReference = "Enter a record reference (1 to 200 characters).";
  if (recordHash && !hashPattern.test(recordHash)) errors.recordHash = "Use 0x followed by 64 hexadecimal characters, or leave the hash blank.";
  const body = { recordReference };
  if (recordHash) body.recordHash = recordHash;
  return { errors, patientId, body };
}

export function createVisitService(client = apiClient) {
  return {
    create(patientId, body) {
      return client.request(`/patients/${encodeURIComponent(patientId)}/visits`, { method: "POST", body });
    },
  };
}

export const visitService = createVisitService();
