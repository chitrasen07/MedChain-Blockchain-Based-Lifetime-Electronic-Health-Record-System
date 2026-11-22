import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { INSTANT_PATIENT_REGISTRY } from "./instantRegistry.js";

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

function progressStores() {
  return [globalThis.localStorage, globalThis.sessionStorage].filter((storage) => storage && typeof storage.getItem === "function");
}

export function formatClaimWait(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  if (hours) return `${hours}h ${minutes}m ${String(rest).padStart(2, "0")}s`;
  if (minutes) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}

export function saveClaimProgress(progress) {
  const stores = progressStores();
  if (!stores.length || !progress?.patientId || !progress?.walletAddress) return;
  const safe = {
    patientId: progress.patientId,
    walletAddress: progress.walletAddress,
    patientRef: progress.patientRef || "",
    sealedClaim: progress.sealedClaim || "",
    announceTx: progress.announceTx || "",
    announcedAt: Number(progress.announcedAt) || 0,
    delaySeconds: Number(progress.delaySeconds) || 0,
    onChainClaim: progress.onChainClaim || "",
  };
  const json = JSON.stringify(safe);
  stores[0].setItem(CLAIM_PROGRESS_KEY, json);
  for (const extra of stores.slice(1)) extra.removeItem(CLAIM_PROGRESS_KEY);
}

export function loadClaimProgress() {
  const stores = progressStores();
  if (!stores.length) return null;
  try {
    const raw = stores.map((storage) => storage.getItem(CLAIM_PROGRESS_KEY)).find(Boolean);
    const parsed = JSON.parse(raw || "null");
    if (!parsed || typeof parsed !== "object" || Object.hasOwn(parsed, "recoveryCode")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function mergeClaimProgress(saved, chain) {
  const localPending = Boolean(saved?.announceTx) && !Number(saved?.announcedAt);
  if (chain?.onChainClaim === "not_submitted" && localPending) {
    return {
      ...(saved || {}),
      onChainClaim: "pending",
      canAnnounce: false,
      canReveal: false,
      message: "Transaction pending. The announce was submitted and is not confirmed yet. Do not send another one.",
    };
  }
  if (chain?.onChainClaim === "instant") {
    return {
      patientId: chain.patientId || saved?.patientId || "",
      walletAddress: chain.walletAddress || saved?.walletAddress || "",
      patientRef: chain.patientRef || "",
      onChainClaim: "instant",
      claimMode: "instant",
      canLink: chain.canLink === true,
      canAnnounce: false,
      canReveal: false,
      message: chain.message || "",
      registryAddress: chain.registryAddress || "",
      typedData: chain.typedData || null,
      announcedAt: 0,
      delaySeconds: 0,
    };
  }
  if (chain?.announcedAt || chain?.onChainClaim === "complete" || chain?.onChainClaim === "wrong_wallet" || chain?.onChainClaim === "mismatch") {
    return {
      patientId: chain.patientId || saved?.patientId || "",
      walletAddress: chain.walletAddress || saved?.walletAddress || "",
      patientRef: chain.patientRef || saved?.patientRef || "",
      sealedClaim: saved?.sealedClaim || "",
      announceTx: chain.announceTx || saved?.announceTx || "",
      announcedAt: Number(chain.announcedAt) || 0,
      delaySeconds: Number(chain.claimDelaySeconds) || Number(saved?.delaySeconds) || 0,
      onChainClaim: chain.onChainClaim,
      canAnnounce: chain.canAnnounce === true,
      canReveal: chain.canReveal === true,
      message: chain.message || "",
    };
  }
  return {
    ...(saved || {}),
    patientRef: chain?.patientRef || saved?.patientRef || "",
    onChainClaim: chain?.onChainClaim || "not_submitted",
    canAnnounce: chain?.canAnnounce !== false,
    canReveal: chain?.canReveal === true,
    message: chain?.message || "",
    delaySeconds: Number(chain?.claimDelaySeconds) || Number(saved?.delaySeconds) || 0,
  };
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

function uintWord(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

export function instantClaimCalldata(patientRef, secret, signature) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef || "") || !/^0x[0-9a-fA-F]{64}$/.test(secret || "") || !/^0x[0-9a-fA-F]{130}$/.test(signature || "")) return "";
  const body = signature.slice(2).toLowerCase().padEnd(192, "0");
  return `${selector("claimController(bytes32,bytes32,bytes)")}${patientRef.slice(2).toLowerCase()}${secret.slice(2).toLowerCase()}${uintWord(96)}${uintWord(65)}${body}`;
}

export function instantRegistryForChain(chainId, registryAddress, localRegistry = "") {
  const requested = String(registryAddress || "");
  if (Number(chainId) === SEPOLIA_CHAIN_ID && /^0x[0-9a-fA-F]{40}$/.test(INSTANT_PATIENT_REGISTRY) && INSTANT_PATIENT_REGISTRY.toLowerCase() === requested.toLowerCase()) {
    return INSTANT_PATIENT_REGISTRY;
  }
  if (Number(chainId) === LOCAL_CLAIM_CHAIN_ID && /^0x[0-9a-fA-F]{40}$/.test(localRegistry) && localRegistry.toLowerCase() === requested.toLowerCase()) {
    return localRegistry;
  }
  return "";
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

export async function sendInstantClaim({ patientRef, secret, signature, registryAddress, chainId, ethereum, from, localRegistry = "" }) {
  const registry = instantRegistryForChain(chainId, registryAddress, localRegistry);
  const data = instantClaimCalldata(patientRef, secret, signature);
  if (!registry || !data || !ethereum?.request) {
    throw Object.assign(new Error("Instant wallet linking is not active in this application build. No transaction was sent."), { code: "claim_blocked" });
  }
  const current = Number(await ethereum.request({ method: "eth_chainId" }));
  if (current !== Number(chainId)) {
    throw Object.assign(new Error("Switch the wallet to Sepolia before linking the wallet."), { code: "claim_blocked" });
  }
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  if (from && String(accounts?.[0] || "").toLowerCase() !== String(from).toLowerCase()) {
    throw Object.assign(new Error("Connect the patient's own wallet. No transaction was sent."), { code: "claim_blocked" });
  }
  return ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to: registry, data }],
  });
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

export async function waitForReceipt(ethereum, hash, { attempts = 20, intervalMs = 3000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = await ethereum.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (receipt?.blockNumber) {
      const block = await ethereum.request({ method: "eth_getBlockByNumber", params: [receipt.blockNumber, false] });
      return { status: receipt.status, announcedAt: Number(BigInt(block.timestamp)) };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}
