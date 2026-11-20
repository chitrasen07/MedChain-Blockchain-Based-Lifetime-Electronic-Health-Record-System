require("dotenv").config();
const { createApp } = require("./app");
const { createDb } = require("./db");
const { createBlockchainAdapter } = require("./blockchain");

// Unset or true keeps production validation. false is local database-only mode.
function readBlockchainEnabled(env) {
  const value = env.BLOCKCHAIN_ENABLED;
  if (value === undefined || String(value).trim() === "") return true;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("BLOCKCHAIN_ENABLED must be true or false");
}

function createRuntime(env) {
  const blockchainEnabled = readBlockchainEnabled(env);
  const required = ["DATABASE_URL", "JWT_SECRET", "IDENTITY_COMMITMENT_KEY", "PII_ENCRYPTION_KEY"];
  if (blockchainEnabled) required.push("CONTROLLER_ADDRESS", "RPC_URL", "PATIENT_REGISTRY_ADDRESS", "BLOCKCHAIN_PRIVATE_KEY");
  for (const name of required) if (!env[name]) throw new Error(`${name} is required`);
  return {
    port: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    bootstrapSecret: env.BOOTSTRAP_SECRET,
    identityCommitmentKey: env.IDENTITY_COMMITMENT_KEY,
    piiEncryptionKey: env.PII_ENCRYPTION_KEY,
    blockchainEnabled,
    rpcUrl: blockchainEnabled ? env.RPC_URL : undefined,
    registryAddress: blockchainEnabled ? env.PATIENT_REGISTRY_ADDRESS : undefined,
    privateKey: blockchainEnabled ? env.BLOCKCHAIN_PRIVATE_KEY : undefined,
    controllerAddress: blockchainEnabled ? env.CONTROLLER_ADDRESS : undefined,
    corsOrigin: env.CORS_ORIGIN || false
  };
}

if (require.main === module) {
  const config = createRuntime(process.env);
  const app = createApp({ db: createDb(config), blockchain: createBlockchainAdapter(config), config });
  app.listen(config.port, () => console.log(`MedChain backend listening on ${config.port}`));
}

module.exports = { createRuntime, readBlockchainEnabled };
