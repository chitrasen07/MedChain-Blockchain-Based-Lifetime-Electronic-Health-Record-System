require("dotenv").config();
const { createApp } = require("./app");
const { createDb } = require("./db");
const { createBlockchainAdapter } = require("./blockchain");

const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  bootstrapSecret: process.env.BOOTSTRAP_SECRET,
  identityCommitmentKey: process.env.IDENTITY_COMMITMENT_KEY,
  piiEncryptionKey: process.env.PII_ENCRYPTION_KEY,
  rpcUrl: process.env.RPC_URL,
  registryAddress: process.env.PATIENT_REGISTRY_ADDRESS,
  privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY,
  controllerAddress: process.env.CONTROLLER_ADDRESS,
  corsOrigin: process.env.CORS_ORIGIN || false
};
for (const name of ["DATABASE_URL", "JWT_SECRET", "IDENTITY_COMMITMENT_KEY", "PII_ENCRYPTION_KEY", "CONTROLLER_ADDRESS", "RPC_URL", "PATIENT_REGISTRY_ADDRESS", "BLOCKCHAIN_PRIVATE_KEY"]) if (!process.env[name]) throw new Error(`${name} is required`);
const app = createApp({ db: createDb(config), blockchain: createBlockchainAdapter(config), config });
app.listen(config.port, () => console.log(`MedChain backend listening on ${config.port}`));
