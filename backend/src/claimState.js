const { AbiCoder, ZeroAddress, getAddress, keccak256 } = require("ethers");

const coder = AbiCoder.defaultAbiCoder();

function patientSlots(patientRef) {
  const base = BigInt(keccak256(coder.encode(["bytes32", "uint256"], [patientRef, 0])));
  const slot = (offset) => `0x${(base + BigInt(offset)).toString(16)}`;
  return { claimant: slot(2), identity: slot(3), claim: slot(4), pendingHash: slot(5), packed: slot(8) };
}

function decodeClaimSlot(word) {
  const value = BigInt(word || 0);
  return {
    registeredAt: Number(value & 0xffffffffffffffffn),
    claimAnnouncedAt: Number((value >> 64n) & 0xffffffffffffffffn),
    recoveryAnnouncedAt: Number((value >> 128n) & 0xffffffffffffffffn),
    active: ((value >> 192n) & 0xffn) === 1n,
    exists: ((value >> 200n) & 0xffn) === 1n
  };
}

function decodeAddressWord(word) {
  const hex = BigInt(word || 0).toString(16).padStart(40, "0").slice(-40);
  return getAddress(`0x${hex}`);
}

function normalizeBytes32(word) {
  return `0x${BigInt(word || 0).toString(16).padStart(64, "0")}`;
}

function claimAnnouncementFromStorage({ claimantWord, packedWord, pendingHashWord }) {
  const packed = decodeClaimSlot(packedWord);
  const claimant = decodeAddressWord(claimantWord);
  if (!packed.exists || !packed.claimAnnouncedAt || claimant === ZeroAddress) return { announced: false };
  return {
    announced: true,
    claimant,
    announcedAt: packed.claimAnnouncedAt,
    pendingClaimHash: normalizeBytes32(pendingHashWord)
  };
}

module.exports = { patientSlots, decodeClaimSlot, claimAnnouncementFromStorage };
