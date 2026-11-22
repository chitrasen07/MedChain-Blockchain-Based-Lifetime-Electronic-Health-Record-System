const hre = require("hardhat");
const { patientSlots, claimAnnouncementFromStorage } = require("../../backend/src/claimState");

// Copies one unclaimed registration onto PatientRegistryV2, then deactivates it on the
// original registry so the delayed reveal cannot assign a second controller.
// Dry-run unless MIGRATE_UNCLAIMED=confirm. A patient who already has a controller is never changed.
const ZERO = "0x0000000000000000000000000000000000000000";
const LEGACY = "0xDe1501AF8BACc3c1040788AFb8d2f784Ab8e2806";

function word(value) {
  return hre.ethers.toBeHex(value, 32);
}

function v2Slots(patientRef) {
  const base = BigInt(hre.ethers.keccak256(hre.ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [patientRef, 0])));
  return {
    identity: `0x${(base + 2n).toString(16)}`,
    claim: `0x${(base + 3n).toString(16)}`
  };
}

async function main() {
  const patientRef = process.env.PATIENT_REF || "";
  const v2Address = process.env.PATIENT_REGISTRY_V2_ADDRESS || "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef) || !/^0x[0-9a-fA-F]{40}$/.test(v2Address)) {
    throw new Error("Set PATIENT_REF and PATIENT_REGISTRY_V2_ADDRESS. This script does not choose a patient.");
  }
  const confirm = process.env.MIGRATE_UNCLAIMED === "confirm";
  const legacy = await hre.ethers.getContractAt("PatientRegistry", LEGACY);
  const next = await hre.ethers.getContractAt("PatientRegistryV2", v2Address);
  const [admin] = await hre.ethers.getSigners();
  const source = await readLegacy(legacy, patientRef);
  if (source.controller !== ZERO) throw new Error("This patient already has a controller. Migration was not sent.");
  if (source.claim === hre.ethers.ZeroHash) throw new Error("The original registration has no recovery commitment.");

  const copied = await readCopy(next, v2Address, patientRef);
  if (!copied.exists && !source.active) {
    throw new Error("The original record is inactive and there is no V2 copy. Migration was not sent.");
  }
  if (!copied.exists) {
    const gas = await estimate(next, legacy, admin, patientRef, source);
    if (!confirm) {
      console.log(JSON.stringify({ dryRun: true, ...summary(patientRef, source, copied), ...gas, transactions: ["registerPatient", "deactivatePatient"] }));
      return;
    }
    const submitted = await next.connect(admin).registerPatient(patientRef, ZERO, source.identity, source.claim);
    const receipt = await submitted.wait();
    if (!receipt || receipt.status !== 1) throw new Error("The V2 copy was not confirmed. The original record was not deactivated.");
  }

  const verified = await readCopy(next, v2Address, patientRef);
  if (!verified.exists || verified.controller !== ZERO || verified.identity !== source.identity || verified.claim !== source.claim) {
    throw new Error("The V2 copy does not match the original registration. The original record was not deactivated.");
  }
  const currentController = await legacy.getController(patientRef);
  if (currentController !== ZERO) {
    if (await next.isActivePatient(patientRef)) {
      const undo = await next.connect(admin).deactivatePatient(patientRef);
      const undoReceipt = await undo.wait();
      if (!undoReceipt || undoReceipt.status !== 1) throw new Error("The original registry gained a controller, and the V2 copy could not be deactivated.");
    }
    throw new Error("The original registry gained a controller during copying. The V2 copy was deactivated and the original owner was left in place.");
  }
  if (!(await legacy.isActivePatient(patientRef))) {
    console.log(JSON.stringify({ migrated: true, patientRef, registry: v2Address, originalDeactivated: true }));
    return;
  }
  if (!confirm) {
    console.log(JSON.stringify({ dryRun: true, resumeDeactivate: true, patientRef, claim: "present" }));
    return;
  }
  const deactivated = await legacy.connect(admin).deactivatePatient(patientRef);
  const deactivatedReceipt = await deactivated.wait();
  if (!deactivatedReceipt || deactivatedReceipt.status !== 1 || await legacy.isActivePatient(patientRef)) {
    throw new Error("The V2 copy is confirmed, but the original record is still active. Run the script again to finish deactivation. Do not register another patient.");
  }
  console.log(JSON.stringify({ migrated: true, patientRef, registry: v2Address }));
}

async function readLegacy(legacy, patientRef) {
  const slots = patientSlots(patientRef);
  const [controller, patient, claimantWord, pendingWord, packedWord, identityWord, claimWord] = await Promise.all([
    legacy.getController(patientRef),
    legacy.getPatient(patientRef),
    hre.ethers.provider.getStorage(LEGACY, slots.claimant),
    hre.ethers.provider.getStorage(LEGACY, slots.pendingHash),
    hre.ethers.provider.getStorage(LEGACY, slots.packed),
    hre.ethers.provider.getStorage(LEGACY, slots.identity),
    hre.ethers.provider.getStorage(LEGACY, slots.claim)
  ]);
  const announcement = claimAnnouncementFromStorage({ claimantWord, packedWord, pendingHashWord: pendingWord });
  return {
    controller,
    active: patient.active,
    identity: word(identityWord),
    claim: word(claimWord),
    announcement
  };
}

async function readCopy(next, v2Address, patientRef) {
  if (!(await next.patientExists(patientRef))) return { exists: false };
  const slots = v2Slots(patientRef);
  const [controller, identityWord, claimWord] = await Promise.all([
    next.getController(patientRef),
    hre.ethers.provider.getStorage(v2Address, slots.identity),
    hre.ethers.provider.getStorage(v2Address, slots.claim)
  ]);
  return { exists: true, controller, identity: word(identityWord), claim: word(claimWord) };
}

function summary(patientRef, source) {
  return {
    patientRef,
    controller: "unclaimed",
    active: source.active,
    identity: "present",
    claim: "present",
    legacyAnnouncement: source.announcement.announced
      ? { announced: true, announcedAt: source.announcement.announcedAt, claimant: source.announcement.claimant }
      : { announced: false }
  };
}

async function estimate(next, legacy, admin, patientRef, source) {
  try {
    const [registerGas, deactivateGas, fee] = await Promise.all([
      next.connect(admin).registerPatient.estimateGas(patientRef, ZERO, source.identity, source.claim),
      legacy.connect(admin).deactivatePatient.estimateGas(patientRef),
      hre.ethers.provider.getFeeData()
    ]);
    return {
      registerGas: registerGas.toString(),
      deactivateGas: deactivateGas.toString(),
      maxFeePerGas: (fee.maxFeePerGas || fee.gasPrice || 0n).toString()
    };
  } catch {
    return { gas: "unavailable" };
  }
}

main().catch((error) => {
  console.error(String(error.shortMessage || error.message || "Migration was not sent.").replace(/https?:\/\/\S+/g, "[url]"));
  process.exit(1);
});
