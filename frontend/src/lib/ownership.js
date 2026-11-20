import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const CLAIM_LABEL = "MedChain.claim.v1";

function bytesToHexPrefixed(bytes) {
  return `0x${bytesToHex(bytes)}`;
}

export function createRecoveryCode() {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return bytesToHexPrefixed(secret);
}

function claimDomain() {
  return keccak_256(new TextEncoder().encode(CLAIM_LABEL));
}

export function claimCommitmentForRecoveryCode(recoveryCode) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(recoveryCode || "")) return "";
  const secret = hexToBytes(recoveryCode.slice(2));
  const encoded = new Uint8Array(64);
  encoded.set(secret, 0);
  encoded.set(claimDomain(), 32);
  return bytesToHexPrefixed(keccak_256(encoded));
}

export function sealedClaimForRecoveryCode(recoveryCode, walletAddress, patientRef) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(recoveryCode || "")) return "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress || "")) return "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef || "")) return "";
  const encoded = new Uint8Array(128);
  encoded.set(hexToBytes(walletAddress.slice(2).padStart(64, "0")), 0);
  encoded.set(hexToBytes(recoveryCode.slice(2)), 32);
  encoded.set(hexToBytes(patientRef.slice(2)), 64);
  encoded.set(claimDomain(), 96);
  return bytesToHexPrefixed(keccak_256(encoded));
}

export function sepoliaTransactionUrl(hash) {
  return /^0x[0-9a-fA-F]{64}$/.test(hash || "") ? `https://sepolia.etherscan.io/tx/${hash}` : "";
}
