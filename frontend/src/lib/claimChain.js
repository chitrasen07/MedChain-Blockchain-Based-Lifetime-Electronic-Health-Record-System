import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const LOCAL_CLAIM_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_PATIENT_REGISTRY = "0xDe1501AF8BACc3c1040788AFb8d2f784Ab8e2806";
const CLAIM_PROGRESS_KEY = "medchain.ownershipClaim";

export function claimBroadcastAllowed(chainId) {
  const chain = Number(chainId);
  return chain === LOCAL_CLAIM_CHAIN_ID || chain === SEPOLIA_CHAIN_ID;
}

export function claimRegistryForChain(chainId, localRegistry = "") {
  if (Number(chainId) === SEPOLIA_CHAIN_ID) return SEPOLIA_PATIENT_REGISTRY;
  if (Number(chainId) === LOCAL_CLAIM_CHAIN_ID && /^0x[0-9a-fA-F]{40}$/.test(localRegistry || "")) return localRegistry;
  return "";
}

export function remainingClaimSeconds(announcedAt, delaySeconds, now = Date.now()) {
  const readyAt = (Number(announcedAt) + Number(delaySeconds)) * 1000;
  if (!Number.isFinite(readyAt)) return 0;
  return Math.max(0, Math.ceil((readyAt - now) / 1000));
}

export function saveClaimProgress(progress) {
  const storage = globalThis.sessionStorage;
  if (!storage || !progress?.patientId || !progress?.walletAddress) return;
  const safe = {
    patientId: progress.patientId,
    walletAddress: progress.walletAddress,
    patientRef: progress.patientRef || "",
    sealedClaim: progress.sealedClaim || "",
    announceTx: progress.announceTx || "",
    announcedAt: Number(progress.announcedAt) || 0,
    delaySeconds: Number(progress.delaySeconds) || 0,
  };
  storage.setItem(CLAIM_PROGRESS_KEY, JSON.stringify(safe));
}

export function loadClaimProgress() {
  const storage = globalThis.sessionStorage;
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(CLAIM_PROGRESS_KEY) || "null");
    if (!parsed || typeof parsed !== "object" || Object.hasOwn(parsed, "recoveryCode")) return null;
    return parsed;
  } catch {
    return null;
  }
}

function selector(signature) {
  const hash = keccak_256(new TextEncoder().encode(signature));
  return `0x${bytesToHex(hash).slice(0, 8)}`;
}

export function transferCalldata(kind, patientRef, newController = "") {
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef || "")) return "";
  if (kind === "accept") return `${selector("acceptControllerTransfer(bytes32)")}${patientRef.slice(2)}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(newController || "")) return "";
  return `${selector("proposeControllerTransfer(bytes32,address)")}${patientRef.slice(2)}${newController.slice(2).toLowerCase().padStart(64, "0")}`;
}

export function claimCalldata(kind, patientRef, value) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef || "") || !/^0x[0-9a-fA-F]{64}$/.test(value || "")) return "";
  const signature = kind === "reveal"
    ? "revealControllerClaim(bytes32,bytes32)"
    : "announceControllerClaim(bytes32,bytes32)";
  return `${selector(signature)}${patientRef.slice(2)}${value.slice(2)}`;
}

function callData(signature) {
  return selector(signature);
}

export async function readClaimDelay(ethereum, registryAddress) {
  const result = await ethereum.request({
    method: "eth_call",
    params: [{ to: registryAddress, data: callData("CLAIM_DELAY()") }, "latest"],
  });
  const delay = Number(BigInt(result));
  if (!Number.isInteger(delay) || delay <= 0) throw new Error("The contract waiting period could not be read.");
  return delay;
}

export async function sendPatientClaim({ kind, patientRef, value, registryAddress, chainId, ethereum }) {
  if (!claimBroadcastAllowed(chainId)) {
    throw Object.assign(new Error("Switch the wallet to Sepolia before sending the claim."), { code: "claim_blocked" });
  }
  const registry = claimRegistryForChain(chainId, registryAddress);
  if (!registry) {
    throw Object.assign(new Error("The patient registry for this network is not configured."), { code: "claim_blocked" });
  }
  const data = kind === "propose" || kind === "accept"
    ? transferCalldata(kind, patientRef, value)
    : claimCalldata(kind, patientRef, value);
  if (!data || !ethereum?.request) {
    throw Object.assign(new Error("The claim transaction could not be prepared."), { code: "claim_blocked" });
  }
  const current = Number(await ethereum.request({ method: "eth_chainId" }));
  if (current !== Number(chainId)) {
    throw Object.assign(new Error("Switch the wallet to Sepolia before sending the claim."), { code: "claim_blocked" });
  }
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  return ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to: registry, data }],
  });
}

export async function waitForReceipt(ethereum, hash) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const receipt = await ethereum.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (receipt?.blockNumber) {
      const block = await ethereum.request({ method: "eth_getBlockByNumber", params: [receipt.blockNumber, false] });
      return { status: receipt.status, announcedAt: Number(BigInt(block.timestamp)) };
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return null;
}
