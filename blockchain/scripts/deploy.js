const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying MedChain contracts with:", deployer.address);

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

  const loggerAddresses = [
    await patientRegistry.getAddress(),
    await recordAccess.getAddress(),
    await emergencyAccess.getAddress(),
    await medicalRecords.getAddress()
  ];

  for (const logger of loggerAddresses) {
    const tx = await auditLog.setAuthorizedLogger(logger, true);
    await tx.wait();
  }

  console.log("\nMedChain local deployment");
  console.log("-------------------------");
  console.log("RoleManager:            ", await roleManager.getAddress());
  console.log("AuditLog:               ", await auditLog.getAddress());
  console.log("PatientRegistry:        ", await patientRegistry.getAddress());
  console.log("RecordAccessControl:    ", await recordAccess.getAddress());
  console.log("EmergencyAccess:        ", await emergencyAccess.getAddress());
  console.log("MedicalRecordRegistry:  ", await medicalRecords.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
