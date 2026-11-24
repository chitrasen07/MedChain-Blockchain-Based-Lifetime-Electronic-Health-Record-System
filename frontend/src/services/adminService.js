import { apiClient } from "../lib/api.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
export const STAFF_CREATE_ROLES = ["receptionist", "doctor", "reviewer", "hospital_staff"];
export const HOSPITAL_STAFF_CHAIN_ROLES = [
  ["NURSE", "Nurse"],
  ["LAB_TECHNICIAN", "Lab technician"],
  ["PHARMACIST", "Pharmacist"],
  ["SPECIALIST", "Specialist"],
];

export function clinicalRole(role) {
  return role === "doctor" || role === "hospital_staff";
}

export function validateStaffAccount(input) {
  const errors = {};
  const later = input.linkWallet === "later";
  const fullName = String(input.fullName || "").trim();
  const email = String(input.email || "").trim();
  const chainRole = input.role === "doctor" ? "DOCTOR" : String(input.chainRole || "");
  if (fullName.length < 2 || fullName.length > 200) errors.fullName = "Enter the staff member's name.";
  if (!emailPattern.test(email) || email.length > 320) errors.email = "Enter a valid work email.";
  if (!later && String(input.password || "").length < 12) errors.password = "Use at least 12 characters.";
  if (!STAFF_CREATE_ROLES.includes(input.role)) errors.role = "Choose receptionist, doctor, reviewer, or hospital staff.";
  if (input.role === "hospital_staff" && !HOSPITAL_STAFF_CHAIN_ROLES.some(([value]) => value === chainRole)) {
    errors.chainRole = "Choose the blockchain role for this hospital staff account.";
  }
  if (!later && clinicalRole(input.role)) {
    if (!addressPattern.test(input.walletAddress || "")) errors.walletAddress = "Connect the staff member's wallet.";
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.walletProof?.nonce || "") || !/^0x[0-9a-fA-F]+$/.test(input.walletProof?.signature || "")) {
      errors.walletProof = "Ask the staff member to sign the wallet link.";
    }
  }
  const body = { fullName, email, role: input.role, linkWallet: later ? "later" : "now" };
  if (!later) body.password = input.password;
  if (input.role === "hospital_staff" || input.role === "doctor") body.chainRole = chainRole;
  if (!later && clinicalRole(input.role)) {
    body.walletProof = { nonce: input.walletProof?.nonce, signature: input.walletProof?.signature };
  }
  return { errors, body };
}

export function createAdminService(client = apiClient) {
  return {
    listUsers() {
      return client.request("/admin/users");
    },
    createUser(body) {
      return client.request("/admin/users", { method: "POST", body });
    },
    walletChallenge(body) {
      return client.request("/admin/staff-wallet/challenge", { method: "POST", body });
    },
    saveAuthorization(id, body) {
      return client.request(`/admin/users/${encodeURIComponent(id)}/authorization`, { method: "POST", body });
    },
    recordAuthorization(id, txHash) {
      return client.request(`/admin/users/${encodeURIComponent(id)}/authorization/result`, {
        method: "POST",
        body: { status: "submitted", txHash },
      });
    },
    markAuthorizationFailed(id, txHash) {
      return client.request(`/admin/users/${encodeURIComponent(id)}/authorization/result`, {
        method: "POST",
        body: txHash ? { status: "failed", txHash } : { status: "failed" },
      });
    },
    verifyAuthorization(id) {
      return client.request(`/admin/users/${encodeURIComponent(id)}/authorization/verify`, { method: "POST" });
    },
    changeRole(id, body) {
      return client.request(`/admin/users/${encodeURIComponent(id)}/role`, { method: "POST", body });
    },
    disableUser(id) {
      return client.request(`/admin/users/${encodeURIComponent(id)}/disable`, { method: "POST" });
    },
    reissueActivation(id) {
      return client.request(`/admin/users/${encodeURIComponent(id)}/activation-code`, { method: "POST" });
    },
    activationChallenge(body) {
      return client.request("/auth/staff-activation/wallet-challenge", { method: "POST", body, authenticated: false });
    },
    activateStaff(body) {
      return client.request("/auth/staff-activation", { method: "POST", body, authenticated: false });
    },
  };
}

export const adminService = createAdminService();
