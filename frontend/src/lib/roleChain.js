import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { SEPOLIA_CHAIN_ID } from "./claimChain.js";

export const SEPOLIA_ROLE_MANAGER = "0xDE4331A5D901B1aBBbE98B51F075e5D0A5894B78";
export const CHAIN_ROLES = [
  ["DOCTOR", "Doctor"],
  ["NURSE", "Nurse"],
  ["LAB_TECHNICIAN", "Lab technician"],
  ["PHARMACIST", "Pharmacist"],
  ["SPECIALIST", "Specialist"],
];

function selector(signature) {
  return `0x${bytesToHex(keccak_256(new TextEncoder().encode(signature))).slice(0, 8)}`;
}

function word(value) {
  return String(value).replace(/^0x/i, "").toLowerCase().padStart(64, "0");
}

export function roleHash(roleName) {
  return `0x${bytesToHex(keccak_256(new TextEncoder().encode(roleName)))}`;
}

function roleCalldata(kind, roleName, account) {
  if (!CHAIN_ROLES.some(([name]) => name === roleName) || !/^0x[0-9a-fA-F]{40}$/.test(account || "")) return "";
  const signature = kind === "revoke" ? "revokeRole(bytes32,address)" : "assignRole(bytes32,address)";
  return `${selector(signature)}${word(roleHash(roleName))}${word(account)}`;
}

export function assignRoleCalldata(roleName, account) {
  return roleCalldata("grant", roleName, account);
}

export function revokeRoleCalldata(roleName, account) {
  return roleCalldata("revoke", roleName, account);
}

async function callRole(ethereum, data) {
  const result = await ethereum.request({
    method: "eth_call",
    params: [{ to: SEPOLIA_ROLE_MANAGER, data }, "latest"],
  });
  return BigInt(result) === 1n;
}

export async function readChainRole(ethereum, account) {
  if (!ethereum?.request || !/^0x[0-9a-fA-F]{40}$/.test(account || "")) return null;
  const accountWord = word(account);
  const [medicalStaff, hospitalAdmin, doctor] = await Promise.all([
    callRole(ethereum, `${selector("isMedicalStaff(address)")}${accountWord}`),
    callRole(ethereum, `${selector("isHospitalAdmin(address)")}${accountWord}`),
    callRole(ethereum, `${selector("hasRole(bytes32,address)")}${word(roleHash("DOCTOR"))}${accountWord}`),
  ]);
  return { medicalStaff, hospitalAdmin, doctor };
}

export async function sendRoleTransaction({ kind = "grant", chainId, roleName, account, ethereum }) {
  if (Number(chainId) !== SEPOLIA_CHAIN_ID) {
    throw Object.assign(new Error("Switch the wallet to Sepolia before changing a role."), { code: "broadcast_blocked" });
  }
  const data = kind === "revoke" ? revokeRoleCalldata(roleName, account) : assignRoleCalldata(roleName, account);
  if (!data || !ethereum?.request) {
    throw Object.assign(new Error("The role transaction could not be prepared."), { code: "broadcast_blocked" });
  }
  const current = Number(await ethereum.request({ method: "eth_chainId" }));
  if (current !== SEPOLIA_CHAIN_ID) {
    throw Object.assign(new Error("Switch the wallet to Sepolia before changing a role."), { code: "broadcast_blocked" });
  }
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  const sender = Array.isArray(accounts) ? accounts[0] : "";
  const senderRole = await readChainRole(ethereum, sender);
  if (!senderRole?.hospitalAdmin) {
    throw Object.assign(new Error("The connected wallet is not a hospital administrator on Sepolia. Switch to the administrator account. No transaction was sent."), { code: "wrong_account" });
  }
  return ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: sender, to: SEPOLIA_ROLE_MANAGER, data }],
  });
}

export async function sendRoleAssignment(input) {
  return sendRoleTransaction({ ...input, kind: "grant" });
}
