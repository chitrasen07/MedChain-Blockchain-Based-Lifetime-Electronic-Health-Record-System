const crypto = require("node:crypto");
const { Contract, FetchRequest, Interface, JsonRpcProvider, Wallet, getAddress, id } = require("ethers");
const { SEPOLIA, createConsentReads, unavailable } = require("./consentReader");

const DUPLICATE_COMMITMENT_SELECTOR = id("IdentityCommitmentAlreadyExists()").slice(0, 10);
const ABI = [
  "function registerPatient(bytes32 patientRef,address controller,bytes32 identityCommitment,bytes32 claimCommitment)",
  "function identityCommitmentExists(bytes32 identityCommitment) view returns (bool)",
  "function patientForCommitment(bytes32 identityCommitment) view returns (bytes32)",
  "function getController(bytes32 patientRef) view returns (address)",
  "function CLAIM_DELAY() view returns (uint256)",
  "error IdentityCommitmentAlreadyExists()",
  "event PatientRegistered(bytes32 indexed patientRef,bytes32 indexed identityCommitment,address controller,uint256 registeredAt)"
];
const ROLE_ABI = [
  "function roleManager() view returns (address)",
  "function isHospitalAdmin(address account) view returns (bool)",
  "function HOSPITAL_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)"
];

function blockchainUnavailable() {
  const error = new Error("Blockchain registration is unavailable");
  error.statusCode = 503;
  return error;
}

function duplicateCommitmentConflict(error) {
  if (!error) return false;
  if (error.revert?.name === "IdentityCommitmentAlreadyExists") return true;
  const data = typeof error.data === "string" ? error.data : "";
  return data.startsWith(DUPLICATE_COMMITMENT_SELECTOR);
}

function duplicateCommitmentError() {
  const error = new Error("A patient with this identity commitment is already registered.");
  error.statusCode = 409;
  error.code = "DUPLICATE_COMMITMENT";
  return error;
}

// Database-only development. No provider, wallet, or transaction is created.
function createDisabledBlockchainAdapter() {
  const reject = async () => { throw blockchainUnavailable(); };
  return {
    enabled: false,
    identityCommitment() { throw blockchainUnavailable(); },
    registerPatient: reject,
    submitRegistration: reject,
    reconcileRegistration: reject,
    commitmentExists: reject,
    verifySigner: reject,
    getController: reject,
    confirmRecordAnchor: reject,
    ...unavailable(blockchainUnavailable)
  };
}

function createBlockchainAdapter(config) {
  if (config.blockchainEnabled === false) return createDisabledBlockchainAdapter();
  const identityCommitment = (value, secret) =>
    `0x${crypto.createHmac("sha256", secret).update(String(value)).digest("hex")}`;
  if (!config.rpcUrl || !config.registryAddress || !config.privateKey) {
    throw new Error("Blockchain integration is not configured");
  }
  const request = new FetchRequest(config.rpcUrl);

if (config.thirdwebSecretKey) {
  request.setHeader("x-secret-key", config.thirdwebSecretKey);
}

const provider = new JsonRpcProvider(request);
  const wallet = new Wallet(config.privateKey, provider);
  const contract = new Contract(config.registryAddress, ABI, wallet);
  const reader = new Contract(config.registryAddress, ABI, provider);
  const parseReceipt = (receipt) => {
    const event = receipt.logs.map((log) => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    }).find((parsed) => parsed && parsed.name === "PatientRegistered");
    if (!event) throw new Error("PatientRegistered event was not found");
    return {
      patientId: event.args.patientRef,
      did: event.args.patientRef,
      controller: event.args.controller,
      txHash: receipt.hash
    };
  };
  return {
    async registerPatient(patientRef, controller, commitment, claimCommitment) {
      const tx = await this.submitRegistration(patientRef, controller, commitment, claimCommitment);
      return this.reconcileRegistration(tx.txHash);
    },
    async submitRegistration(patientRef, controller, commitment, claimCommitment) {
      try {
        const tx = await contract.registerPatient(patientRef, controller, commitment, claimCommitment);
        return { txHash: tx.hash };
      } catch (error) {
        if (duplicateCommitmentConflict(error)) throw duplicateCommitmentError();
        throw error;
      }
    },
    async reconcileRegistration(txHash) {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return { status: "pending", txHash };
      if (receipt.status !== 1) return { status: "failed", txHash };
      return { status: "confirmed", ...parseReceipt(receipt) };
    },
    async commitmentExists(commitment) {
      return contract.identityCommitmentExists(commitment);
    },
    async getController(patientRef) {
      return reader.getController(patientRef);
    },
    async confirmRecordAnchor(txHash, recordRef, contentHash) {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return { status: "pending", txHash };
      const events = new Interface([
        "event RecordVersionAppended(bytes32 indexed recordRef, bytes32 indexed patientRef, bytes32 recordHash, uint256 versionIndex, address indexed author)"
      ]);
      const match = receipt.status === 1 && receipt.to && getAddress(receipt.to) === getAddress(SEPOLIA.medicalRecords)
        ? receipt.logs.map((log) => {
          try { return events.parseLog(log); } catch { return null; }
        }).find((parsed) => parsed
          && parsed.name === "RecordVersionAppended"
          && String(parsed.args.recordRef).toLowerCase() === String(recordRef).toLowerCase()
          && String(parsed.args.recordHash).toLowerCase() === String(contentHash).toLowerCase())
        : null;
      return { status: match ? "confirmed" : "failed", txHash };
    },
    async getClaimDelay() {
      return Number(await contract.CLAIM_DELAY());
    },
    async verifySigner() {
      const registry = new Contract(config.registryAddress, [...ABI, ...ROLE_ABI], provider);
      const roleManagerAddress = await registry.roleManager();
      const roleManager = new Contract(roleManagerAddress, ROLE_ABI, provider);
      const signerAddress = await wallet.getAddress();
      const role = await roleManager.HOSPITAL_ADMIN_ROLE();
      return {
        signerAddress,
        registryAddress: config.registryAddress,
        roleManagerAddress,
        isHospitalAdmin: await roleManager.isHospitalAdmin(signerAddress),
        hasHospitalAdminRole: await roleManager.hasRole(role, signerAddress)
      };
    },
    identityCommitment,
    ...createConsentReads({
      provider,
      registryAddress: config.registryAddress,
      signerAddress: wallet.address,
      fail: blockchainUnavailable
    })
  };
}

module.exports = { createBlockchainAdapter, duplicateCommitmentConflict, ABI, ROLE_ABI };
