import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { LOCAL_CLAIM_CHAIN_ID, SEPOLIA_CHAIN_ID } from "./claimChain.js";

function selector(signature) {
  const hash = keccak_256(new TextEncoder().encode(signature));
  return `0x${bytesToHex(hash).slice(0, 8)}`;
}

function word(value) {
  return value.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
}

function addressWord(address) {
  return address.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
}

function uintWord(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

export function reasonHash(reason) {
  return `0x${bytesToHex(keccak_256(new TextEncoder().encode(String(reason))))}`;
}

export function grantCalldata(patientRef, wallet, expiresAt) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef || "") || !/^0x[0-9a-fA-F]{40}$/.test(wallet || "")) return "";
  return `${selector("grantAccess(bytes32,address,uint256)")}${word(patientRef)}${addressWord(wallet)}${uintWord(expiresAt)}`;
}

export function revokeCalldata(patientRef, wallet) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef || "") || !/^0x[0-9a-fA-F]{40}$/.test(wallet || "")) return "";
  return `${selector("revokeAccess(bytes32,address)")}${word(patientRef)}${addressWord(wallet)}`;
}

export function emergencyRequestCalldata(patientRef, reason, durationSeconds) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef || "")) return "";
  return `${selector("requestEmergencyAccess(bytes32,bytes32,uint256)")}${word(patientRef)}${word(reasonHash(reason))}${uintWord(durationSeconds)}`;
}

export function anchorCalldata({ versionIndex, recordRef, patientRef, contentHash }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(recordRef || "") || !/^0x[0-9a-fA-F]{64}$/.test(contentHash || "")) return "";
  if (Number(versionIndex) > 0) {
    return `${selector("appendRecordVersion(bytes32,bytes32,uint256)")}${word(recordRef)}${word(contentHash)}${uintWord(0)}`;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef || "")) return "";
  return `${selector("createRecord(bytes32,bytes32,bytes32,uint256)")}${word(recordRef)}${word(patientRef)}${word(contentHash)}${uintWord(0)}`;
}

export const SEPOLIA_RECORD_ACCESS = "0xe520020bDBE95039697e93B4305cDCe7e682CEa6";
export const SEPOLIA_MEDICAL_RECORDS = "0x83A6DB7481E7037b9fBd063f14bE50097f8258Cd";

const CONSENT_SELECTORS = new Set([
  selector("grantAccess(bytes32,address,uint256)"),
  selector("revokeAccess(bytes32,address)"),
]);
const ANCHOR_SELECTORS = new Set([
  selector("createRecord(bytes32,bytes32,bytes32,uint256)"),
  selector("appendRecordVersion(bytes32,bytes32,uint256)"),
]);

export function transactionTarget(action, chainId, localAddress = "") {
  const chain = Number(chainId);
  if (chain === SEPOLIA_CHAIN_ID) {
    if (action === "consent") return SEPOLIA_RECORD_ACCESS;
    if (action === "anchor") return SEPOLIA_MEDICAL_RECORDS;
    return "";
  }
  if (chain === LOCAL_CLAIM_CHAIN_ID && /^0x[0-9a-fA-F]{40}$/.test(localAddress || "")) return localAddress;
  return "";
}

function sepoliaDestination(data) {
  const chosen = String(data || "").slice(0, 10).toLowerCase();
  if (CONSENT_SELECTORS.has(chosen)) return SEPOLIA_RECORD_ACCESS;
  if (ANCHOR_SELECTORS.has(chosen)) return SEPOLIA_MEDICAL_RECORDS;
  return "";
}

const ANCHOR_REVERTS = {
  "0x82b42900": "This wallet cannot anchor the record. Check the Doctor role and patient consent. No transaction was sent.",
  "0x453a6b78": "This patient is not active on Sepolia. No transaction was sent.",
  "0x1a9fb0df": "This version is already anchored. No transaction was sent.",
  "0x0af806e0": "The prepared record hash does not match this version. No transaction was sent.",
  "0x041a90b0": "The anchor would fail on Sepolia. No transaction was sent.",
  "0x3e07f1a1": "Anchor the previous version before this one. No transaction was sent.",
  "0xfda880e0": "This version is already anchored. No transaction was sent.",
  "0xeb484391": "The prepared transaction did not match this record. No transaction was sent.",
};

export function anchorRevertMessage(error) {
  const text = JSON.stringify(error?.data ?? error?.error ?? error?.message ?? "");
  const selector = Object.keys(ANCHOR_REVERTS).find((item) => text.toLowerCase().includes(item));
  return selector ? ANCHOR_REVERTS[selector] : "The anchor would fail on Sepolia. No transaction was sent.";
}

function assertAnchorDestination(chainId, contractAddress, data) {
  const chain = Number(chainId);
  const address = String(contractAddress || "");
  if (chain === SEPOLIA_CHAIN_ID) {
    const destination = sepoliaDestination(data);
    if (destination !== SEPOLIA_MEDICAL_RECORDS || address.toLowerCase() !== destination.toLowerCase()) {
      throw Object.assign(new Error("The record registry for this network is not the deployed MedChain contract. No transaction was sent."), { code: "broadcast_blocked" });
    }
    return;
  }
  if (chain !== LOCAL_CLAIM_CHAIN_ID || !/^0x[0-9a-fA-F]{40}$/.test(address) || !/^0x[0-9a-fA-F]{8,}$/.test(data || "")) {
    throw Object.assign(new Error("Switch the wallet to Sepolia before anchoring. No transaction was sent."), { code: "wrong_network" });
  }
}

export async function previewAnchorTransaction({ chainId, contractAddress, data, from, ethereum }) {
  assertAnchorDestination(chainId, contractAddress, data);
  if (!ethereum?.request) {
    throw Object.assign(new Error("A wallet extension is required. No transaction was sent."), { code: "broadcast_blocked" });
  }
  const current = Number(await ethereum.request({ method: "eth_chainId" }));
  if (current !== Number(chainId)) {
    throw Object.assign(new Error("Switch the wallet to Sepolia before anchoring. No transaction was sent."), { code: "wrong_network" });
  }
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  const sender = Array.isArray(accounts) ? accounts[0] : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(from || "") || String(sender).toLowerCase() !== String(from).toLowerCase()) {
    throw Object.assign(new Error("Switch MetaMask to the consented clinical wallet. No transaction was sent."), { code: "wrong_wallet" });
  }
  try {
    await ethereum.request({ method: "eth_call", params: [{ from: sender, to: contractAddress, data }, "latest"] });
  } catch (error) {
    throw Object.assign(new Error(anchorRevertMessage(error)), { code: "simulation_failed" });
  }
  return sender;
}

export async function sendPreparedTransaction({ chainId, contractAddress, data, ethereum, from }) {
  const chain = Number(chainId);
  const address = String(contractAddress || "");
  if (chain === SEPOLIA_CHAIN_ID) {
    const destination = sepoliaDestination(data);
    if (!destination || address.toLowerCase() !== destination.toLowerCase()) {
      throw Object.assign(new Error("This Sepolia transaction is not one of the approved consent or record actions."), { code: "broadcast_blocked" });
    }
  } else if (chain !== LOCAL_CLAIM_CHAIN_ID || !/^0x[0-9a-fA-F]{40}$/.test(address) || !/^0x[0-9a-fA-F]{8,}$/.test(data || "")) {
    throw Object.assign(new Error("Public transactions are not sent without approval."), { code: "broadcast_blocked" });
  }
  if (!ethereum?.request) {
    throw Object.assign(new Error("A wallet extension is required. No transaction was sent."), { code: "broadcast_blocked" });
  }
  const current = Number(await ethereum.request({ method: "eth_chainId" }));
  if (current !== chain) {
    throw Object.assign(new Error("Switch the wallet to Sepolia before sending this transaction."), { code: "broadcast_blocked" });
  }
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  if (from && String(accounts?.[0] || "").toLowerCase() !== String(from).toLowerCase()) {
    throw Object.assign(new Error("Switch MetaMask to the consented clinical wallet. No transaction was sent."), { code: "wrong_wallet" });
  }
  return ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to: address, data }],
  });
}
