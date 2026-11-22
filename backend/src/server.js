const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();
const { createApp } = require("./app");
const { createFileStore } = require("./fileStore");
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
  if (blockchainEnabled) required.push("RPC_URL", "PATIENT_REGISTRY_ADDRESS", "BLOCKCHAIN_PRIVATE_KEY");
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
    chainId: Number(env.CHAIN_ID || 11155111),
    instantRegistry: blockchainEnabled ? readInstantRegistry(env) : null,
    privateKey: blockchainEnabled ? env.BLOCKCHAIN_PRIVATE_KEY : undefined,
    thirdwebSecretKey: blockchainEnabled ? env.THIRDWEB_SECRET_KEY : undefined,
    corsOrigin: env.CORS_ORIGIN || false,
    secureCookie: readTrustProxy(env) === 1,
    demoDisableRateLimit: String(env.DEMO_DISABLE_RATE_LIMIT || "").trim().toLowerCase() === "true",
    trustProxy: readTrustProxy(env)
  };
}

// One trusted hop is Render's proxy. true would let a client choose the address.
function readInstantRegistry(env) {
  const fromEnv = [
    String(env.PATIENT_REGISTRY_V2_ADDRESS || "").trim(),
    String(env.RECORD_ACCESS_V2_ADDRESS || "").trim(),
    String(env.EMERGENCY_ACCESS_V2_ADDRESS || "").trim(),
    String(env.MEDICAL_RECORD_REGISTRY_V2_ADDRESS || "").trim()
  ];
  const committed = committedInstant();
  const values = fromEnv.every((item) => item === "") && committed
    ? [committed.registry, committed.recordAccess, committed.emergency, committed.medicalRecords]
    : fromEnv;
  if (values.every((item) => item === "")) return null;
  if (values.some((item) => !/^0x[0-9a-fA-F]{40}$/.test(item))) {
    throw new Error("Instant-claim contract addresses must be configured together");
  }
  return { registry: values[0], recordAccess: values[1], emergency: values[2], medicalRecords: values[3] };
}

function committedInstant() {
  try {
    const file = path.join(__dirname, "..", "..", "blockchain", "deployments", "sepolia-v2.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const contracts = parsed.contracts || {};
    return {
      registry: contracts.PatientRegistryV2 || "",
      recordAccess: contracts.RecordAccessControlV2 || "",
      emergency: contracts.EmergencyAccessV2 || "",
      medicalRecords: contracts.MedicalRecordRegistryV2 || ""
    };
  } catch {
    return null;
  }
}

function readTrustProxy(env) {
  const value = String(env.TRUST_PROXY ?? "").trim().toLowerCase();
  if (value === "0" || value === "false") return false;
  if (value === "1") return 1;
  if (String(env.NODE_ENV || "").trim() === "production") return 1;
  if (String(env.RENDER || "").trim().toLowerCase() === "true") return 1;
  return false;
}

if (require.main === module) {
  const config = createRuntime(process.env);
  const app = createApp({
    db: createDb(config),
    blockchain: createBlockchainAdapter(config),
    config,
    fileStore: createFileStore(process.env)
  });
  app.listen(config.port, () => console.log(`MedChain backend listening on ${config.port}`));
}

module.exports = { createRuntime, readBlockchainEnabled, readTrustProxy };
