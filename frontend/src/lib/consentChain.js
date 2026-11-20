import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { LOCAL_CLAIM_CHAIN_ID, claimBroadcastAllowed } from "./claimChain.js";

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

export function consentBroadcastAllowed(chainId) {
  return claimBroadcastAllowed(chainId);
}

export async function sendPreparedTransaction({ chainId, contractAddress, data, ethereum }) {
  if (Number(chainId) !== LOCAL_CLAIM_CHAIN_ID) {
    throw Object.assign(new Error("Public transactions are not sent without approval."), { code: "broadcast_blocked" });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress || "") || !/^0x[0-9a-fA-F]{8,}$/.test(data || "")) {
    throw Object.assign(new Error("A local contract address is not configured."), { code: "broadcast_blocked" });
  }
  if (!ethereum?.request) {
    throw Object.assign(new Error("A wallet extension is required. No transaction was sent."), { code: "broadcast_blocked" });
  }
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  return ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to: contractAddress, data }],
  });
}
