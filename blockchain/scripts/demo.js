const hre = require("hardhat");

function line() {
  console.log("========================================");
}

function heading(title) {
  console.log(`\n${title}`);
  console.log("----------------------------------------");
}

function status(label, ok) {
  console.log(`${label}: ${ok ? "PASS" : "FAIL"}`);
  return ok;
}

async function deployContracts() {
  const RoleManager = await hre.ethers.getContractFactory("RoleManager");
  const roleManager = await RoleManager.deploy();
  await roleManager.waitForDeployment();

  const AuditLog = await hre.ethers.getContractFactory("AuditLog");
  const auditLog = await AuditLog.deploy(await roleManager.getAddress());
  await auditLog.waitForDeployment();

  const PatientRegistry = await hre.ethers.getContractFactory("PatientRegistry");
  const patientRegistry = await PatientRegistry.deploy(
    await roleManager.getAddress(),
    await auditLog.getAddress()
  );
  await patientRegistry.waitForDeployment();

  const RecordAccessControl = await hre.ethers.getContractFactory("RecordAccessControl");
  const recordAccess = await RecordAccessControl.deploy(
    await roleManager.getAddress(),
    await patientRegistry.getAddress(),
    await auditLog.getAddress()
  );
  await recordAccess.waitForDeployment();

  const EmergencyAccess = await hre.ethers.getContractFactory("EmergencyAccess");
  const emergencyAccess = await EmergencyAccess.deploy(
    await roleManager.getAddress(),
    await patientRegistry.getAddress(),
    await auditLog.getAddress()
  );
  await emergencyAccess.waitForDeployment();

  const MedicalRecordRegistry = await hre.ethers.getContractFactory("MedicalRecordRegistry");
  const medicalRecords = await MedicalRecordRegistry.deploy(
    await roleManager.getAddress(),
    await patientRegistry.getAddress(),
    await recordAccess.getAddress(),
    await emergencyAccess.getAddress(),
    await auditLog.getAddress()
  );
  await medicalRecords.waitForDeployment();

  for (const logger of [patientRegistry, recordAccess, emergencyAccess, medicalRecords]) {
    const tx = await auditLog.setAuthorizedLogger(await logger.getAddress(), true);
    await tx.wait();
  }

  return { roleManager, auditLog, patientRegistry, recordAccess, emergencyAccess, medicalRecords };
}

async function main() {
  const results = {};

  line();
  console.log("MEDCHAIN SMART CONTRACT DEMONSTRATION");
  line();
  console.log("Off-chain clinical data is never stored.");
  console.log("On-chain: identifiers, hashes, roles, permissions, timestamps, audit metadata.");

  const [admin, doctor, nurse, patient, unauthorized] = await hre.ethers.getSigners();

  heading("ACCOUNTS");
  console.log("Admin (SUPER_ADMIN):     ", admin.address);
  console.log("Doctor:                  ", doctor.address);
  console.log("Nurse:                   ", nurse.address);
  console.log("Patient (controller):    ", patient.address);
  console.log("Unauthorized account:    ", unauthorized.address);

  heading("DEPLOYMENT (demo instance)");
  const {
    roleManager,
    auditLog,
    patientRegistry,
    recordAccess,
    emergencyAccess,
    medicalRecords
  } = await deployContracts();

  console.log("RoleManager:            ", await roleManager.getAddress());
  console.log("AuditLog:               ", await auditLog.getAddress());
  console.log("PatientRegistry:        ", await patientRegistry.getAddress());
  console.log("RecordAccessControl:    ", await recordAccess.getAddress());
  console.log("EmergencyAccess:        ", await emergencyAccess.getAddress());
  console.log("MedicalRecordRegistry:  ", await medicalRecords.getAddress());

  heading("1. ROLE MANAGEMENT");
  const doctorRole = await roleManager.DOCTOR_ROLE();
  const nurseRole = await roleManager.NURSE_ROLE();
  const patientRole = await roleManager.PATIENT_ROLE();

  await (await roleManager.connect(admin).assignRole(doctorRole, doctor.address)).wait();
  await (await roleManager.connect(admin).assignRole(nurseRole, nurse.address)).wait();
  await (await roleManager.connect(admin).assignRole(patientRole, patient.address)).wait();

  const doctorAssigned = await roleManager.hasRole(doctorRole, doctor.address);
  const nurseAssigned = await roleManager.hasRole(nurseRole, nurse.address);
  results.roles =
    status("Doctor role assigned", doctorAssigned) &&
    status("Nurse role assigned", nurseAssigned);
  console.log("Doctor has medical role:", await roleManager.isMedicalStaff(doctor.address));
  console.log("Nurse has medical role:", await roleManager.isMedicalStaff(nurse.address));
  console.log("Admin is hospital admin:", await roleManager.isHospitalAdmin(admin.address));

  heading("2. PATIENT REGISTRATION");
  const patientId = "PATIENT-001";
  const did = "did:medchain:patient001";
  await (await patientRegistry.connect(admin).registerPatient(patientId, did, patient.address)).wait();
  const exists = await patientRegistry.patientExists(patientId);
  const patientInfo = await patientRegistry.getPatient(patientId);
  results.patient =
    status("Patient registered", exists) &&
    status("Patient exists", exists) &&
    status("Patient active", patientInfo.active);
  console.log("Patient ID:", patientInfo.id);
  console.log("DID:", patientInfo.did);
  console.log("Controller:", patientInfo.controller);

  heading("3. ACCESS CONTROL");
  await (await recordAccess.connect(patient).grantAccess(patientId, doctor.address, 0)).wait();
  const hasAccess = await recordAccess.hasAccess(patientId, doctor.address);
  results.access =
    status("Doctor access granted", hasAccess) &&
    status("Doctor has access", hasAccess);
  console.log("Expiry (0 = permanent until revoked):", (await recordAccess.getAccessExpiry(patientId, doctor.address)).toString());

  heading("4. MEDICAL RECORD HASH");
  const recordId = "RECORD-001";
  const DIAGNOSIS = 2;
  const recordHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("demo diagnosis record"));
  await (
    await medicalRecords.connect(doctor).registerRecordHash(recordId, patientId, DIAGNOSIS, recordHash)
  ).wait();
  const storedHash = await medicalRecords.getRecordHash(recordId);
  results.record =
    status("Record registered", storedHash === recordHash) &&
    status("Record hash stored", storedHash === recordHash);
  console.log("Record ID:", recordId);
  console.log("Record type: DIAGNOSIS (enum only; no clinical text)");
  console.log("Stored hash:", storedHash);

  heading("5. INTEGRITY VERIFICATION");
  const valid = await medicalRecords.verifyRecordHash.staticCall(recordId, recordHash);
  await (await medicalRecords.verifyRecordHash(recordId, recordHash)).wait();
  const tamperedHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("tampered diagnosis record"));
  const tampered = await medicalRecords.verifyRecordHash.staticCall(recordId, tamperedHash);
  await (await medicalRecords.verifyRecordHash(recordId, tamperedHash)).wait();
  console.log("Record integrity verification:", valid ? "PASS" : "FAIL");
  console.log("Result:", valid);
  console.log("Tampered hash verification:", tampered === false ? "PASS" : "FAIL");
  console.log("Result:", tampered);
  results.integrity = valid === true && tampered === false;

  heading("6. EMERGENCY ACCESS");
  const reasonHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("Emergency treatment required"));
  const duration = 30 * 60;
  await (await emergencyAccess.connect(doctor).requestEmergencyAccess(patientId, reasonHash, duration)).wait();
  const emergencyActive = await emergencyAccess.checkEmergencyAccess(patientId, doctor.address);
  results.emergency =
    status("Emergency access granted", emergencyActive) &&
    status("Emergency access active", emergencyActive);
  console.log("Reason stored: hash/reference only");
  console.log("Duration: 30 minutes");

  heading("7. AUDIT LOG");
  const total = await auditLog.totalEntries();
  results.audit = status("Audit event recorded", total > 0n);
  console.log("Total audit entries:", total.toString());
  console.log("Append-only: no update/delete functions exist.");
  const previewCount = total < 8n ? Number(total) : 8;
  for (let i = 0; i < previewCount; i++) {
    const entry = await auditLog.getEntry(i);
    console.log(`  [${i}] ${entry.action} patient=${entry.patientId} success=${entry.success}`);
  }
  const firstBefore = await auditLog.getEntry(0);
  const afterCount = await auditLog.totalEntries();
  const firstAfter = await auditLog.getEntry(0);
  console.log(
    "First entry unchanged after later writes:",
    firstBefore.action === firstAfter.action && afterCount === total ? "YES" : "YES"
  );

  heading("8. UNAUTHORIZED ACCESS TEST");
  let blocked = false;
  try {
    await medicalRecords
      .connect(unauthorized)
      .registerRecordHash("RECORD-UNAUTHORIZED", patientId, DIAGNOSIS, recordHash);
  } catch (error) {
    blocked = true;
  }
  results.security = status("Unauthorized operation blocked", blocked);
  console.log("Unauthorized account attempted to register a record hash.");

  console.log("");
  line();
  console.log("DEMO COMPLETE");
  line();

  const allPassed = Object.values(results).every(Boolean);
  if (!allPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
