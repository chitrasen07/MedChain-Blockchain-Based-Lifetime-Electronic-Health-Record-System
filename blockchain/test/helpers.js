const { ethers } = require("hardhat");

async function deploySystem() {
  const [deployer, hospitalAdmin, doctor, nurse, specialist, patient, stranger, extra] =
    await ethers.getSigners();

  const RoleManager = await ethers.getContractFactory("RoleManager");
  const roleManager = await RoleManager.deploy();
  await roleManager.waitForDeployment();

  const AuditLog = await ethers.getContractFactory("AuditLog");
  const auditLog = await AuditLog.deploy(await roleManager.getAddress());
  await auditLog.waitForDeployment();

  const PatientRegistry = await ethers.getContractFactory("PatientRegistry");
  const patientRegistry = await PatientRegistry.deploy(
    await roleManager.getAddress(),
    await auditLog.getAddress()
  );
  await patientRegistry.waitForDeployment();

  const RecordAccessControl = await ethers.getContractFactory("RecordAccessControl");
  const recordAccess = await RecordAccessControl.deploy(
    await roleManager.getAddress(),
    await patientRegistry.getAddress(),
    await auditLog.getAddress()
  );
  await recordAccess.waitForDeployment();

  const EmergencyAccess = await ethers.getContractFactory("EmergencyAccess");
  const emergencyAccess = await EmergencyAccess.deploy(
    await roleManager.getAddress(),
    await patientRegistry.getAddress(),
    await auditLog.getAddress()
  );
  await emergencyAccess.waitForDeployment();

  const MedicalRecordRegistry = await ethers.getContractFactory("MedicalRecordRegistry");
  const medicalRecords = await MedicalRecordRegistry.deploy(
    await roleManager.getAddress(),
    await patientRegistry.getAddress(),
    await recordAccess.getAddress(),
    await emergencyAccess.getAddress(),
    await auditLog.getAddress()
  );
  await medicalRecords.waitForDeployment();

  for (const logger of [patientRegistry, recordAccess, emergencyAccess, medicalRecords]) {
    await auditLog.setAuthorizedLogger(await logger.getAddress(), true);
  }

  await roleManager.assignRole(await roleManager.HOSPITAL_ADMIN_ROLE(), hospitalAdmin.address);
  await roleManager.connect(hospitalAdmin).assignRole(await roleManager.DOCTOR_ROLE(), doctor.address);
  await roleManager.connect(hospitalAdmin).assignRole(await roleManager.NURSE_ROLE(), nurse.address);
  await roleManager.connect(hospitalAdmin).assignRole(await roleManager.SPECIALIST_ROLE(), specialist.address);
  await roleManager.connect(hospitalAdmin).assignRole(await roleManager.PATIENT_ROLE(), patient.address);

  return {
    deployer,
    hospitalAdmin,
    doctor,
    nurse,
    specialist,
    patient,
    stranger,
    extra,
    roleManager,
    auditLog,
    patientRegistry,
    recordAccess,
    emergencyAccess,
    medicalRecords
  };
}

function commitmentFor(patientRef, label) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "string"], [patientRef, label]));
}

async function registerSamplePatient(ctx, controller = ctx.patient.address) {
  const patientRef = ethers.hexlify(ethers.randomBytes(32));
  const identityCommitment = commitmentFor(patientRef, `identity-${controller}`);
  await ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(
    patientRef,
    controller,
    identityCommitment,
    ethers.ZeroHash
  );
  return patientRef;
}

function claimCommitment(secret) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [secret, ethers.keccak256(ethers.toUtf8Bytes("MedChain.claim.v1"))]
    )
  );
}

function sealedClaim(claimant, secret, patientRef) {
  const domain = ethers.keccak256(ethers.toUtf8Bytes("MedChain.claim.v1"));
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32", "bytes32", "bytes32"],
      [claimant, secret, patientRef, domain]
    )
  );
}

function recoveryCommitment(secret) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [secret, ethers.keccak256(ethers.toUtf8Bytes("MedChain.recovery.v1"))]
    )
  );
}

function sealedRecovery(claimant, secret, patientRef) {
  const domain = ethers.keccak256(ethers.toUtf8Bytes("MedChain.recovery.v1"));
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32", "bytes32", "bytes32"],
      [claimant, secret, patientRef, domain]
    )
  );
}

module.exports = {
  deploySystem,
  registerSamplePatient,
  commitmentFor,
  claimCommitment,
  sealedClaim,
  recoveryCommitment,
  sealedRecovery
};
