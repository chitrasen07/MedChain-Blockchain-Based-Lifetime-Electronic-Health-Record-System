import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const LOCAL_CLAIM_CHAIN_ID = 31337;

export function claimBroadcastAllowed(chainId) {
  return Number(chainId) === LOCAL_CLAIM_CHAIN_ID;
}

function selector(signature) {
  const hash = keccak_256(new TextEncoder().encode(signature));
  return `0x${bytesToHex(hash).slice(0, 8)}`;
}

export function claimCalldata(kind, patientRef, value) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef || "") || !/^0x[0-9a-fA-F]{64}$/.test(value || "")) return "";
  const signature = kind === "reveal"
    ? "revealControllerClaim(bytes32,bytes32)"
    : "announceControllerClaim(bytes32,bytes32)";
  return `${selector(signature)}${patientRef.slice(2)}${value.slice(2)}`;
}

export async function sendPatientClaim({ kind, patientRef, value, registryAddress, chainId, ethereum }) {
  if (!claimBroadcastAllowed(chainId)) {
    throw Object.assign(new Error("Public claim transactions are not sent without approval."), { code: "claim_blocked" });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(registryAddress || "")) {
    throw Object.assign(new Error("A local patient registry is not configured."), { code: "claim_blocked" });
  }
  const data = claimCalldata(kind, patientRef, value);
  if (!data || !ethereum?.request) {
    throw Object.assign(new Error("The claim transaction could not be prepared."), { code: "claim_blocked" });
  }
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  return ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to: registryAddress, data }],
  });
}
