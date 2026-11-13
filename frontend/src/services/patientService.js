import { apiClient } from "../lib/api.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function emptyProfile() {
  return { fullName: "", dateOfBirth: "", mobile: "", email: "", emergencyContact: "", reviewCaseId: "" };
}

export function validateProfile(input, { reviewCase = false } = {}) {
  const errors = {};
  const fullName = input.fullName.trim();
  const dateOfBirth = input.dateOfBirth.trim();
  const mobile = input.mobile.trim();
  const email = input.email.trim();
  const emergencyContact = input.emergencyContact.trim();
  const reviewCaseId = input.reviewCaseId.trim();

  if (fullName.length < 2 || fullName.length > 200) errors.fullName = "Enter the full name (2 to 200 characters).";
  if (!datePattern.test(dateOfBirth)) errors.dateOfBirth = "Enter the date of birth as YYYY-MM-DD.";
  if (mobile.length > 40) errors.mobile = "Mobile must be 40 characters or fewer.";
  if (email && (!emailPattern.test(email) || email.length > 320)) errors.email = "Enter a valid email address.";
  if (emergencyContact.length > 200) errors.emergencyContact = "Emergency contact must be 200 characters or fewer.";
  if (reviewCase && reviewCaseId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reviewCaseId)) {
    errors.reviewCaseId = "Enter the review case ID as a UUID, or leave it blank.";
  }

  const profile = { fullName, dateOfBirth };
  if (mobile) profile.mobile = mobile;
  if (email) profile.email = email;
  if (emergencyContact) profile.emergencyContact = emergencyContact;

  return { errors, profile, reviewCaseId };
}

export function describeMatch(result) {
  if (result?.status === "no_match") {
    return "No confirmed patient in this hospital matched this profile.";
  }
  if (result?.status === "high_confidence") {
    const patientId = result.patient?.patient_id || result.patientId;
    return patientId
      ? `A confirmed patient matches this profile. Patient ID ${patientId}.`
      : "A confirmed patient matches this profile.";
  }
  if (result?.status === "review_required") {
    const count = Number.isInteger(result.candidateCount) ? `${result.candidateCount} candidate(s). ` : "";
    return `${count}This possible match needs review. It was not sent to the chain.`;
  }
  return "The match result could not be read.";
}

export function describeRegistration(result, error) {
  if (error?.resultStatus === "registration_failed") {
    return "The registration failed. It is not confirmed on the chain.";
  }
  if (!result) return "";
  if (result.status === "existing_patient") {
    return `This profile matches an existing patient${result.patientId ? ` (${result.patientId})` : ""}. No new registration was created.`;
  }
  if (result.status === "confirmed" || (result.patientId && result.did && !result.status)) {
    return `Registration is confirmed. Patient ID ${result.patientId}. DID ${result.did}.`;
  }
  if (result.status === "review_required") {
    return "Registration stopped for manual review. Nothing was confirmed on the chain.";
  }
  if (result.status === "registration_submitted") {
    return "A registration transaction was submitted. Confirmation is not complete.";
  }
  if (result.status === "registration_pending" || result.status === "registration_submission_in_progress") {
    return "Registration is still in progress. It is not confirmed on the chain.";
  }
  if (result.status === "registration_reconciliation_required") {
    return "The registration outcome is uncertain and needs reconciliation. It is not confirmed.";
  }
  return "The registration response did not include a known status.";
}

export function createPatientService(client = apiClient) {
  return {
    match(profile) {
      return client.request("/patients/match", { method: "POST", body: profile });
    },
    register(profile, reviewCaseId) {
      return client.request("/patients", {
        method: "POST",
        body: reviewCaseId ? { ...profile, reviewCaseId } : profile,
      });
    },
    get(patientId) {
      return client.request(`/patients/${encodeURIComponent(patientId)}`);
    },
  };
}

export const patientService = createPatientService();
