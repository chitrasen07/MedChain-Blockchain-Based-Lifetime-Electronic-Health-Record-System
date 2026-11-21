import { apiClient } from "../lib/api.js";

export function validateDecision(input, candidateIds = []) {
  const errors = {};
  const decision = input.decision;
  const notes = input.notes.trim();
  const candidatePatientId = input.candidatePatientId;
  if (!["same_patient", "different_person", "reject"].includes(decision)) {
    errors.decision = "Choose same person, different person, or reject.";
  }
  if (decision === "same_patient" && !candidateIds.includes(candidatePatientId)) {
    errors.candidatePatientId = "Choose one of the candidate identifiers from this case.";
  }
  if (notes.length > 1000) errors.notes = "Notes must be 1,000 characters or fewer.";
  const body = { decision };
  if (decision === "same_patient") body.candidatePatientId = candidatePatientId;
  if (notes) body.notes = notes;
  return { errors, body };
}

export function describeDecision(result) {
  if (result?.registrationRequired) {
    const caseId = result.reviewCaseId ? ` Review case ${result.reviewCaseId}.` : "";
    return `The case was marked as a different person.${caseId} Return to Patient Registration with the same details and check for a match. No new review case is created, and the patient can then be registered. This did not write a chain transaction.`;
  }
  if (result?.status === "resolved_same") {
    return result.patientId
      ? `The case was linked to patient ${result.patientId}.`
      : "The case was linked to the selected candidate.";
  }
  if (result?.status === "rejected") return "The case was rejected.";
  if (result?.status) return `The case status is ${result.status}.`;
  return "The decision was recorded.";
}

export function createReviewService(client = apiClient) {
  return {
    list() {
      return client.request("/review-cases");
    },
    get(id) {
      return client.request(`/review-cases/${encodeURIComponent(id)}`);
    },
    decide(id, body) {
      return client.request(`/review-cases/${encodeURIComponent(id)}/decision`, { method: "POST", body });
    },
  };
}

export const reviewService = createReviewService();
