require("dotenv").config();
const { createBlockchainAdapter } = require("../src/blockchain");

async function main() {
  for (const name of ["RPC_URL", "PATIENT_REGISTRY_ADDRESS", "BLOCKCHAIN_PRIVATE_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} is required`);
  }
  const adapter = createBlockchainAdapter({
  rpcUrl: process.env.RPC_URL,
  registryAddress: process.env.PATIENT_REGISTRY_ADDRESS,
  privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY,
  thirdwebSecretKey: process.env.THIRDWEB_SECRET_KEY
});
  const result = await adapter.verifySigner();
  console.log(JSON.stringify(result, null, 2));
  if (!result.isHospitalAdmin) {
  throw new Error("Configured signer is not authorized as a hospital administrator");
}
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
