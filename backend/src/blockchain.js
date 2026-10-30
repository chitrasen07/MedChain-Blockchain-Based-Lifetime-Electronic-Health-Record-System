const crypto = require("node:crypto");
const { Contract, FetchRequest, JsonRpcProvider, Wallet } = require("ethers");

const ABI = [
  "function registerPatient(address controller) returns (string patientId)",
  "function registerPatientWithIdentityCommitment(address controller, bytes32 identityCommitment) returns (string patientId)",
  "function identityCommitmentExists(bytes32 identityCommitment) view returns (bool)",
  "event PatientRegistered(string patientId,string did,address indexed controller,uint256 registeredAt)"
];
const ROLE_ABI = [
  "function roleManager() view returns (address)",
  "function isHospitalAdmin(address account) view returns (bool)",
  "function HOSPITAL_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)"
];

function createBlockchainAdapter(config) {
  const identityCommitment = (value, secret) =>
    `0x${crypto.createHmac("sha256", secret).update(String(value)).digest("hex")}`;
  if (!config.rpcUrl || !config.registryAddress || !config.privateKey) {
    return {
      identityCommitment,
      async registerPatient() { throw new Error("Blockchain integration is not configured"); }
      ,async submitRegistration() { throw new Error("Blockchain integration is not configured"); }
      ,async reconcileRegistration() { throw new Error("Blockchain integration is not configured"); }
    };
  }
  const request = new FetchRequest(config.rpcUrl);

if (config.thirdwebSecretKey) {
  request.setHeader("x-secret-key", config.thirdwebSecretKey);
}

const provider = new JsonRpcProvider(request);
  const wallet = new Wallet(config.privateKey, provider);
  const contract = new Contract(config.registryAddress, ABI, wallet);
  const parseReceipt = (receipt) => {
    const event = receipt.logs.map((log) => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    }).find((parsed) => parsed && parsed.name === "PatientRegistered");
    if (!event) throw new Error("PatientRegistered event was not found");
    return { patientId: event.args.patientId, did: event.args.did, txHash: receipt.hash };
  };
  return {
    async registerPatient(controller, commitment) {
      const tx = await this.submitRegistration(controller, commitment);
      return this.reconcileRegistration(tx.txHash);
    },
    async submitRegistration(controller, commitment) {
      const tx = commitment
        ? await contract.registerPatientWithIdentityCommitment(controller, commitment)
        : await contract.registerPatient(controller);
      return { txHash: tx.hash };
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
  };
}

module.exports = { createBlockchainAdapter, ABI, ROLE_ABI };
