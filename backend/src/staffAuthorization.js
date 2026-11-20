const CLINICAL_APP_ROLES = new Set(["doctor", "hospital_staff"]);
const HOSPITAL_STAFF_CHAIN_ROLES = ["NURSE", "LAB_TECHNICIAN", "PHARMACIST", "SPECIALIST"];
const CHAIN_ROLES = ["DOCTOR", ...HOSPITAL_STAFF_CHAIN_ROLES];

const WALLET_REQUIRED = "The staff wallet must sign before a clinical account is created.";
const DOCTOR_CHAIN_ROLE = "A doctor account uses the Doctor chain role.";
const HOSPITAL_STAFF_CHAIN_ROLE = "Choose Nurse, Lab technician, Pharmacist, or Specialist for hospital staff.";
const NON_CLINICAL_WALLET = "This role does not use a blockchain wallet.";
const ROLE_ESCALATION = "This role cannot be granted on the blockchain.";

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isClinicalRole(role) {
  return CLINICAL_APP_ROLES.has(role);
}

function chainRoleFor(appRole, requested) {
  if (!CHAIN_ROLES.includes(requested || "") && requested) throw httpError(ROLE_ESCALATION, 400);
  if (!isClinicalRole(appRole)) {
    if (requested) throw httpError(NON_CLINICAL_WALLET, 400);
    return "";
  }
  if (appRole === "doctor") {
    if (requested && requested !== "DOCTOR") throw httpError(DOCTOR_CHAIN_ROLE, 400);
    return "DOCTOR";
  }
  if (!HOSPITAL_STAFF_CHAIN_ROLES.includes(requested)) throw httpError(HOSPITAL_STAFF_CHAIN_ROLE, 400);
  return requested;
}

function staffWalletMessage({ fullName, email, role, chainRole, walletAddress, nonce, expiresAt }) {
  return [
    "MedChain Staff Wallet",
    `Name: ${fullName}`,
    `Email: ${email}`,
    `Role: ${role}`,
    `Chain role: ${chainRole}`,
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`
  ].join("\n");
}

function messageMatches(message, { fullName, email, role, chainRole, walletAddress }) {
  const expected = [
    "MedChain Staff Wallet",
    `Name: ${fullName}`,
    `Email: ${email}`,
    `Role: ${role}`,
    `Chain role: ${chainRole}`,
    `Wallet: ${walletAddress}`
  ];
  return expected.every((line) => String(message || "").includes(line));
}

module.exports = {
  CHAIN_ROLES,
  HOSPITAL_STAFF_CHAIN_ROLES,
  WALLET_REQUIRED,
  DOCTOR_CHAIN_ROLE,
  HOSPITAL_STAFF_CHAIN_ROLE,
  NON_CLINICAL_WALLET,
  ROLE_ESCALATION,
  isClinicalRole,
  chainRoleFor,
  staffWalletMessage,
  messageMatches,
  httpError
};
