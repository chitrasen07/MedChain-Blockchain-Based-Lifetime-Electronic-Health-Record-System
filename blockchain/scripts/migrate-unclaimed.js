const hre = require("hardhat");

// Copies one unclaimed registration onto PatientRegistryV2, then deactivates it on the
// original registry so the delayed reveal cannot assign a second controller.
// Dry-run unless MIGRATE_UNCLAIMED=confirm. Never changes a patient who already has a controller.
const ZERO = "0x0000000000000000000000000000000000000000";

async function main() {
  const patientRef = process.env.PATIENT_REF || "";
  const v2Address = process.env.PATIENT_REGISTRY_V2_ADDRESS || "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef) || !/^0x[0-9a-fA-F]{40}$/.test(v2Address)) {
    throw new Error("Set PATIENT_REF and PATIENT_REGISTRY_V2_ADDRESS. This script does not choose a patient.");
  }
  const legacyAddress = "0xDe1501AF8BACc3c1040788AFb8d2f784Ab8e2806";
  const legacy = await hre.ethers.getContractAt("PatientRegistry", legacyAddress);
  const next = await hre.ethers.getContractAt("PatientRegistryV2", v2Address);
  const controller = await legacy.getController(patientRef);
  if (controller !== ZERO) throw new Error("This patient already has a controller. Migration was not sent.");
  if (await next.patientExists(patientRef)) throw new Error("This reference is already on PatientRegistryV2. Migration was not sent.");
  const { patientSlots } = require("../../backend/src/claimState");
  const slots = patientSlots(patientRef);
  const [identityWord, claimWord] = await Promise.all([
    hre.ethers.provider.getStorage(legacyAddress, slots.identity),
    hre.ethers.provider.getStorage(legacyAddress, slots.claim)
  ]);
  const identity = hre.ethers.toBeHex(identityWord, 32);
  const claim = hre.ethers.toBeHex(claimWord, 32);
  if (claim === hre.ethers.ZeroHash) throw new Error("The original registration has no recovery commitment.");
  const plan = { patientRef, identity, claim, deactivateLegacy: true };
  if (process.env.MIGRATE_UNCLAIMED !== "confirm") {
    console.log(JSON.stringify({ dryRun: true, ...plan, claim: "present" }));
    return;
  }
  const [admin] = await hre.ethers.getSigners();
  const copied = await next.connect(admin).registerPatient(patientRef, ZERO, identity, claim);
  await copied.wait();
  const deactivated = await legacy.connect(admin).deactivatePatient(patientRef);
  await deactivated.wait();
  console.log(JSON.stringify({ migrated: true, patientRef, registry: v2Address }));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
