const { Interface, getAddress, keccak256, toUtf8Bytes } = require("ethers");

const EMERGENCY_MAX_SECONDS = 72 * 60 * 60;
const EMERGENCY_CATEGORIES = new Set(["allergy", "diagnosis", "prescription", "laboratory"]);
const HOSPITAL_BYPASS = "The hospital signing wallet cannot grant, revoke, or use patient consent.";
const CONSENT_REQUIRED = "Patient consent is required.";
const EMERGENCY_LIMIT = "Emergency access is limited to necessary medical information.";
const WALLET_REQUIRED = "Connect the clinical wallet that holds patient consent.";
const NOT_CLINICAL = "This wallet is not eligible clinical staff on-chain.";
const NOT_RESPONDER = "This wallet is not an emergency responder.";
const EMERGENCY_COOLDOWN = "Emergency access is in cooldown.";
const ANCHOR_PREPARED = "Sign this with the consented clinical wallet. The hospital wallet is not used. Public networks are not sent without approval.";

const recordAccessInterface = new Interface([
  "function grantAccess(bytes32 patientRef, address authorizedAddress, uint256 expiresAt)",
  "function revokeAccess(bytes32 patientRef, address authorizedAddress)"
]);
const emergencyInterface = new Interface([
  "function requestEmergencyAccess(bytes32 patientRef, bytes32 reasonHash, uint256 duration)",
  "function revokeEmergencyAccess(bytes32 patientRef, address doctor)"
]);
const recordInterface = new Interface([
  "function createRecord(bytes32 recordRef, bytes32 patientRef, bytes32 recordHash, uint256 recordDate)",
  "function appendRecordVersion(bytes32 recordRef, bytes32 recordHash, uint256 recordDate)"
]);

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function reasonHash(reason) {
  return keccak256(toUtf8Bytes(String(reason)));
}

function grantCalldata(patientRef, wallet, expiresAt) {
  return recordAccessInterface.encodeFunctionData("grantAccess", [patientRef, getAddress(wallet), expiresAt]);
}

function revokeCalldata(patientRef, wallet) {
  return recordAccessInterface.encodeFunctionData("revokeAccess", [patientRef, getAddress(wallet)]);
}

function emergencyCalldata(patientRef, reason, durationSeconds) {
  return emergencyInterface.encodeFunctionData("requestEmergencyAccess", [
    patientRef,
    reasonHash(reason),
    durationSeconds
  ]);
}

function revokeEmergencyCalldata(patientRef, wallet) {
  return emergencyInterface.encodeFunctionData("revokeEmergencyAccess", [patientRef, getAddress(wallet)]);
}

function anchorCalldata({ versionIndex, recordRef, patientRef, contentHash }) {
  if (Number(versionIndex) > 0) {
    return recordInterface.encodeFunctionData("appendRecordVersion", [recordRef, contentHash, 0]);
  }
  return recordInterface.encodeFunctionData("createRecord", [recordRef, patientRef, contentHash, 0]);
}

function decideClinicalAccess({ wallet, hospitalSigner, medicalStaff, hasAccess, emergency }) {
  if (!wallet) throw httpError(WALLET_REQUIRED, 403);
  if (hospitalSigner && getAddress(wallet) === getAddress(hospitalSigner)) throw httpError(HOSPITAL_BYPASS, 403);
  if (!medicalStaff) throw httpError(NOT_CLINICAL, 403);
  if (hasAccess) return "consent";
  if (emergency) return "emergency";
  throw httpError(CONSENT_REQUIRED, 403);
}

function permissionStatus(active, expiresAt, nowSeconds) {
  if (active) return "active";
  if (expiresAt && Number(expiresAt) !== 0 && nowSeconds >= Number(expiresAt)) return "expired";
  return "revoked";
}

module.exports = {
  EMERGENCY_MAX_SECONDS,
  EMERGENCY_CATEGORIES,
  HOSPITAL_BYPASS,
  CONSENT_REQUIRED,
  EMERGENCY_LIMIT,
  WALLET_REQUIRED,
  NOT_CLINICAL,
  NOT_RESPONDER,
  EMERGENCY_COOLDOWN,
  ANCHOR_PREPARED,
  reasonHash,
  grantCalldata,
  revokeCalldata,
  emergencyCalldata,
  revokeEmergencyCalldata,
  anchorCalldata,
  decideClinicalAccess,
  permissionStatus,
  httpError
};
