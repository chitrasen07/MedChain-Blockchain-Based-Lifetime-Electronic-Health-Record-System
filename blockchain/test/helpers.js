const { expect } = require("chai");
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

  const loggers = [
    patientRegistry,
    recordAccess,
    emergencyAccess,
    medicalRecords
  ];
  for (const logger of loggers) {
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

async function registerSamplePatient(ctx, patientId = "P100245") {
  await ctx.patientRegistry
    .connect(ctx.hospitalAdmin)
    .registerPatient(patientId, "did:medchain:abc123", ctx.patient.address);
  return patientId;
}

module.exports = { deploySystem, registerSamplePatient };
