import { apiClient } from "../lib/api.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const DRAFT_KEY = "medchain.registrationDraft";

export function emptyProfile() {
  return { fullName: "", dateOfBirth: "", gender: "", bloodGroup: "", mobile: "", email: "", emergencyContact: "", reviewCaseId: "" };
}

export function loadRegistrationDraft() {
  const storage = globalThis.sessionStorage;
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(DRAFT_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.recoveryCode || parsed.secret || parsed.claimCommitment) return null;
    return { ...emptyProfile(), ...Object.fromEntries(Object.keys(emptyProfile()).map((key) => [key, String(parsed[key] || "")])) };
  } catch {
    return null;
  }
}

export function saveRegistrationDraft(profile) {
  const storage = globalThis.sessionStorage;
  if (!storage || !profile) return;
  const draft = emptyProfile();
  for (const key of Object.keys(draft)) draft[key] = String(profile[key] || "");
  storage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearRegistrationDraft() {
  globalThis.sessionStorage?.removeItem(DRAFT_KEY);
}

export function rememberResolvedReview(reviewCaseId) {
  const current = loadRegistrationDraft() || emptyProfile();
  saveRegistrationDraft({ ...current, reviewCaseId });
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
  if ((input.gender || "").trim().length > 40) errors.gender = "Gender must be 40 characters or fewer.";
  if ((input.bloodGroup || "").trim().length > 16) errors.bloodGroup = "Blood group must be 16 characters or fewer.";
  if (reviewCase && reviewCaseId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reviewCaseId)) {
    errors.reviewCaseId = "Enter the review case ID as a UUID, or leave it blank.";
  }

  const profile = { fullName, dateOfBirth };
  if (mobile) profile.mobile = mobile;
  if (email) profile.email = email;
  if (emergencyContact) profile.emergencyContact = emergencyContact;
  if (input.gender?.trim()) profile.gender = input.gender.trim();
  if (input.bloodGroup?.trim()) profile.bloodGroup = input.bloodGroup.trim();

  return { errors, profile, reviewCaseId };
}

export function describeMatch(result) {
  if (result?.status === "no_match") {
    return "No matching patient found. Registration is allowed.";
  }
  if (result?.status === "review_authorized") {
    return "Different-person review accepted. Registration is allowed.";
  }
  if (result?.status === "high_confidence" || result?.status === "review_same_person" || result?.status === "existing_patient") {
    const patientId = result.patientId || result.patient?.patient_id;
    return patientId
      ? `Same-person match. This profile is already registered as ${patientId}. A new Patient ID was not created.`
      : "Same-person match. This profile is already registered. A new Patient ID was not created.";
  }
  if (result?.status === "review_required") {
    if (result.reviewState === "new_candidates") {
      return result.message || "A new possible match appeared after the earlier review. Resolve the new review case before registering.";
    }
    if (result.reviewState === "pending") {
      return "Possible duplicate. This review is still pending, so registration stays blocked until a reviewer marks the person as different.";
    }
    return "Possible duplicate. Review is required before this patient can be registered.";
  }
  return "The match result could not be read.";
}

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;

export function validateOwnership(input = {}) {
  const errors = {};
  const mode = input.mode === "wallet" ? "wallet" : "claim";
  if (mode === "wallet") {
    const controller = String(input.controller || "").trim();
    if (!addressPattern.test(controller) || /^0x0{40}$/i.test(controller)) {
      errors.controller = "Connect the patient's wallet.";
    }
    const nonce = String(input.walletProof?.nonce || "");
    const signature = String(input.walletProof?.signature || "");
    if (!bytes32Pattern.test(nonce) || !/^0x[0-9a-fA-F]+$/.test(signature)) {
      errors.walletProof = "Ask the patient to sign the wallet link in MetaMask.";
    }
    return {
      errors,
      ownership: Object.keys(errors).length ? null : { controller, walletProof: { nonce, signature } },
    };
  }
  const claimCommitment = String(input.claimCommitment || "").trim();
  if (!bytes32Pattern.test(claimCommitment) || /^0x0{64}$/i.test(claimCommitment)) {
    errors.claimCommitment = "Generate a recovery code before registering.";
  }
  if (!input.recoverySaved) errors.recoverySaved = "Save the recovery code with the patient before registering.";
  return { errors, ownership: Object.keys(errors).length ? null : { claimCommitment } };
}

export function registrationBody(profile, reviewCaseId, ownership) {
  const body = { ...profile };
  if (reviewCaseId) body.reviewCaseId = reviewCaseId;
  if (ownership?.controller) body.controller = ownership.controller;
  if (ownership?.walletProof) body.walletProof = ownership.walletProof;
  if (ownership?.claimCommitment) body.claimCommitment = ownership.claimCommitment;
  delete body.secret;
  delete body.recoveryCode;
  delete body.mode;
  delete body.recoverySaved;
  return body;
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
    return `Registration is confirmed. Lifetime patient ID ${result.patientId}.`;
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

export function registrationReady(match) {
  return match?.status === "no_match" || match?.status === "review_authorized";
}

export function createPatientService(client = apiClient) {
  return {
    match(profile, reviewCaseId) {
      const body = { ...profile };
      if (reviewCaseId) body.reviewCaseId = reviewCaseId;
      return client.request("/patients/match", { method: "POST", body });
    },
    walletChallenge(walletAddress) {
      return client.request("/patient-registration/wallet-challenge", { method: "POST", body: { walletAddress } });
    },
    register(profile, reviewCaseId, ownership) {
      return client.request("/patients", {
        method: "POST",
        body: registrationBody(profile, reviewCaseId, ownership),
      });
    },
    get(patientId) {
      return client.request(`/patients/${encodeURIComponent(patientId)}`);
    },
  };
}

export const patientService = createPatientService();
