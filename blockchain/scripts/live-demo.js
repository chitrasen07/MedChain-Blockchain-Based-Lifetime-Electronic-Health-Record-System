const hre = require("hardhat");

const CONTRACTS = {
  RoleManager: "0xf0829df45fc3a2566536bfc92e1d4943b5135edd",
  AuditLog: "0xb7e41b6aea0f056f5e82c8bfc61d23fe2f68bb61",
  PatientRegistry: "0xae338c92fa2514788e9d6f2a02f742fa2bf8c91f",
  RecordAccessControl: "0xf61b8155681ff30b5b0c354b28038646d2bca028",
  EmergencyAccess: "0x0091020cf79c93e032edfee1d830e8d90233fe03",
  MedicalRecordRegistry: "0xe01fe301b9c503c1fadb35eddb20547648776321",
};

async function main() {
  const network = await hre.ethers.provider.getNetwork();

  console.log("MedChain Sepolia Live Check");
  console.log("Chain ID:", network.chainId.toString());

  if (network.chainId !== 11155111n) {
    throw new Error("Wrong network! Expected Sepolia.");
  }

  for (const [name, address] of Object.entries(CONTRACTS)) {
    if (!hre.ethers.isAddress(address)) {
      throw new Error(`${name}: Please enter a valid contract address.`);
    }

    const code = await hre.ethers.provider.getCode(address);

    if (code === "0x") {
      throw new Error(`${name}: No contract found at ${address}`);
    }

    console.log(`${name}: OK - ${address}`);
  }

  const roleManager = await hre.ethers.getContractAt(
    "RoleManager",
    CONTRACTS.RoleManager
  );

  console.log(
    "RoleManager contract connected:",
    await roleManager.getAddress()
  );

  console.log("All six contract addresses passed the checks.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});