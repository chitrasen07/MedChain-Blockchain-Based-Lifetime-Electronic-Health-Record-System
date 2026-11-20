const fs = require("node:fs/promises");
const path = require("node:path");
const hre = require("hardhat");

const ALLOWED_CHAIN_IDS = new Set([31337, 11155111]);

function metadataSuffix(bytecode) {
  const hex = bytecode.toLowerCase().replace(/^0x/, "");
  if (hex.length < 4) return "";
  const metadataBytes = Number.parseInt(hex.slice(-4), 16);
  const suffixChars = (metadataBytes + 2) * 2;
  if (!Number.isInteger(metadataBytes) || metadataBytes < 32 || suffixChars > hex.length) return "";
  return hex.slice(-suffixChars);
}

async function deployContract(name, factory, args) {
  const contract = await factory.deploy(...args);
  const receipt = await contract.deploymentTransaction().wait();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const artifact = await hre.artifacts.readArtifact(name);
  const compiledBytecode = typeof artifact.deployedBytecode === "string"
    ? artifact.deployedBytecode
    : artifact.deployedBytecode.object;
  let onChain = "0x";
  for (let attempt = 0; attempt < 5 && onChain === "0x"; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    onChain = await hre.ethers.provider.getCode(address);
  }
  const bytecodeMetadataMatches = metadataSuffix(onChain) === metadataSuffix(compiledBytecode);
  if (onChain === "0x" || !bytecodeMetadataMatches) {
    throw new Error(`${name} deployed bytecode does not match the compiled artifact`);
  }
  return {
    contract,
    record: {
      address,
      transactionHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
      bytecodeMetadataMatches
    }
  };
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (!ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new Error(`Refusing to deploy on chain ${chainId}. Only local Hardhat and Sepolia are allowed.`);
  }

  const [deployer] = await hre.ethers.getSigners();
  const contracts = {};
  let gasUsed = 0n;

  const roleManager = await deployContract("RoleManager", await hre.ethers.getContractFactory("RoleManager"), []);
  contracts.RoleManager = roleManager.record;
  gasUsed += BigInt(roleManager.record.gasUsed);

  const auditLog = await deployContract(
    "AuditLog",
    await hre.ethers.getContractFactory("AuditLog"),
    [roleManager.record.address]
  );
  contracts.AuditLog = auditLog.record;
  gasUsed += BigInt(auditLog.record.gasUsed);

  const patientRegistry = await deployContract(
    "PatientRegistry",
    await hre.ethers.getContractFactory("PatientRegistry"),
    [roleManager.record.address, auditLog.record.address]
  );
  contracts.PatientRegistry = patientRegistry.record;
  gasUsed += BigInt(patientRegistry.record.gasUsed);

  const recordAccess = await deployContract(
    "RecordAccessControl",
    await hre.ethers.getContractFactory("RecordAccessControl"),
    [roleManager.record.address, patientRegistry.record.address, auditLog.record.address]
  );
  contracts.RecordAccessControl = recordAccess.record;
  gasUsed += BigInt(recordAccess.record.gasUsed);

  const emergencyAccess = await deployContract(
    "EmergencyAccess",
    await hre.ethers.getContractFactory("EmergencyAccess"),
    [roleManager.record.address, patientRegistry.record.address, auditLog.record.address]
  );
  contracts.EmergencyAccess = emergencyAccess.record;
  gasUsed += BigInt(emergencyAccess.record.gasUsed);

  const medicalRecords = await deployContract(
    "MedicalRecordRegistry",
    await hre.ethers.getContractFactory("MedicalRecordRegistry"),
    [
      roleManager.record.address,
      patientRegistry.record.address,
      recordAccess.record.address,
      emergencyAccess.record.address,
      auditLog.record.address
    ]
  );
  contracts.MedicalRecordRegistry = medicalRecords.record;
  gasUsed += BigInt(medicalRecords.record.gasUsed);

  const loggers = [
    patientRegistry.record.address,
    recordAccess.record.address,
    emergencyAccess.record.address,
    medicalRecords.record.address
  ];
  const loggerTransactions = [];
  for (const logger of loggers) {
    const tx = await auditLog.contract.setAuthorizedLogger(logger, true);
    const receipt = await tx.wait();
    loggerTransactions.push({ logger, transactionHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
    gasUsed += receipt.gasUsed;
    if (!(await auditLog.contract.authorizedLoggers(logger))) {
      throw new Error(`Audit logger was not authorized: ${logger}`);
    }
  }
  if (await auditLog.contract.authorizedLoggers(deployer.address)) {
    throw new Error("The deployer must not be an audit logger");
  }

  const adminRole = await roleManager.contract.HOSPITAL_ADMIN_ROLE();
  const adminTx = await roleManager.contract.assignRole(adminRole, deployer.address);
  const adminReceipt = await adminTx.wait();
  gasUsed += adminReceipt.gasUsed;
  if (!(await roleManager.contract.isHospitalAdmin(deployer.address))) {
    throw new Error("Deployer was not authorized as a hospital administrator");
  }

  const dependencies = {
    auditLogRoleManager: (await auditLog.contract.roleManager()).toLowerCase() === roleManager.record.address.toLowerCase(),
    patientRegistryRoleManager: (await patientRegistry.contract.roleManager()).toLowerCase() === roleManager.record.address.toLowerCase(),
    patientRegistryAuditLog: (await patientRegistry.contract.auditLog()).toLowerCase() === auditLog.record.address.toLowerCase(),
    recordAccessPatientRegistry: (await recordAccess.contract.patientRegistry()).toLowerCase() === patientRegistry.record.address.toLowerCase(),
    emergencyAccessPatientRegistry: (await emergencyAccess.contract.patientRegistry()).toLowerCase() === patientRegistry.record.address.toLowerCase(),
    medicalRecordAccess: (await medicalRecords.contract.recordAccess()).toLowerCase() === recordAccess.record.address.toLowerCase(),
    medicalEmergencyAccess: (await medicalRecords.contract.emergencyAccess()).toLowerCase() === emergencyAccess.record.address.toLowerCase()
  };
  if (Object.values(dependencies).some((linked) => !linked)) {
    throw new Error("A deployed contract dependency does not match the deployment");
  }

  const manifest = {
    network: hre.network.name,
    chainId,
    deployer: deployer.address,
    hospitalAdmin: deployer.address,
    contracts,
    auditLoggers: loggerTransactions,
    hospitalAdminTransaction: {
      transactionHash: adminReceipt.hash,
      gasUsed: adminReceipt.gasUsed.toString()
    },
    dependencies,
    totalGasUsed: gasUsed.toString()
  };
  const output = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Chain ID: ${chainId}`);
  console.log(`Deployer and hospital administrator: ${deployer.address}`);
  for (const [name, record] of Object.entries(contracts)) {
    console.log(`${name}: ${record.address} gas ${record.gasUsed}`);
  }
  console.log(`Total gas used: ${gasUsed.toString()}`);
  console.log(`Manifest: deployments/${hre.network.name}.json`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
