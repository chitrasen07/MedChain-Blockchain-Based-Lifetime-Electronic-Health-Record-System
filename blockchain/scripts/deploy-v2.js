const fs = require("node:fs/promises");
const path = require("node:path");
const hre = require("hardhat");

const EXISTING = {
  roleManager: "0xDE4331A5D901B1aBBbE98B51F075e5D0A5894B78",
  auditLog: "0x85175F99DB99613DF7ce8452dd7C16eF475431B6",
  patientRegistry: "0xDe1501AF8BACc3c1040788AFb8d2f784Ab8e2806"
};

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (Number(network.chainId) !== 11155111) {
    throw new Error("PatientRegistryV2 production deployment is Sepolia-only. Local tests deploy their own copy.");
  }
  const [deployer] = await hre.ethers.getSigners();
  const roleManager = await hre.ethers.getContractAt("RoleManager", EXISTING.roleManager);
  const auditLog = await hre.ethers.getContractAt("AuditLog", EXISTING.auditLog);
  if (!(await roleManager.isHospitalAdmin(deployer.address))) {
    throw new Error("The signer is not a hospital administrator on the existing RoleManager.");
  }

  const registry = await hre.ethers.deployContract("PatientRegistryV2", [EXISTING.roleManager, EXISTING.auditLog]);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  const authorize = async (address) => {
    const tx = await auditLog.setAuthorizedLogger(address, true);
    await tx.wait();
  };
  await authorize(registryAddress);

  const access = await hre.ethers.deployContract("RecordAccessControl", [
    EXISTING.roleManager,
    registryAddress,
    EXISTING.auditLog
  ]);
  await access.waitForDeployment();
  const accessAddress = await access.getAddress();
  await authorize(accessAddress);

  const emergency = await hre.ethers.deployContract("EmergencyAccess", [
    EXISTING.roleManager,
    registryAddress,
    EXISTING.auditLog
  ]);
  await emergency.waitForDeployment();
  const emergencyAddress = await emergency.getAddress();
  await authorize(emergencyAddress);

  const records = await hre.ethers.deployContract("MedicalRecordRegistry", [
    EXISTING.roleManager,
    registryAddress,
    accessAddress,
    emergencyAddress,
    EXISTING.auditLog
  ]);
  await records.waitForDeployment();
  const recordsAddress = await records.getAddress();
  await authorize(recordsAddress);

  if ((await records.patientRegistry()).toLowerCase() !== registryAddress.toLowerCase()) {
    throw new Error("The new record registry does not point at PatientRegistryV2.");
  }
  const manifest = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    previousPatientRegistry: EXISTING.patientRegistry,
    contracts: {
      PatientRegistryV2: registryAddress,
      RecordAccessControlV2: accessAddress,
      EmergencyAccessV2: emergencyAddress,
      MedicalRecordRegistryV2: recordsAddress
    },
    migration: "not-run"
  };
  const file = path.join(__dirname, "..", "deployments", "sepolia-v2.json");
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest.contracts));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
