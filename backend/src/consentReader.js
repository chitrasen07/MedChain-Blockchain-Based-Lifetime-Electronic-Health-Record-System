const { Contract, getAddress, id } = require("ethers");
const { EMERGENCY_MAX_SECONDS } = require("./consentChain");

const SEPOLIA_CHAIN_ID = 11155111;
const SEPOLIA = {
  registry: "0xDe1501AF8BACc3c1040788AFb8d2f784Ab8e2806",
  recordAccess: "0xe520020bDBE95039697e93B4305cDCe7e682CEa6",
  emergency: "0x7c662d0649eDa6406Decd37020a2aD3ea811Fbd6",
  medicalRecords: "0x83A6DB7481E7037b9fBd063f14bE50097f8258Cd",
  auditLog: "0x85175F99DB99613DF7ce8452dd7C16eF475431B6",
  recordAccessTx: "0x5942b443d81c04eb9f7e7a65669b8bc8bda6cecd871bac6dd3c25bf927d41632"
};

const AUDIT_ACTIONS = Object.fromEntries([
  "ACCESS_GRANTED",
  "ACCESS_REVOKED",
  "ACCESS_EXPIRED",
  "EMERGENCY_ACCESS_GRANTED",
  "EMERGENCY_ACCESS_REVOKED",
  "EMERGENCY_ACCESS_EXPIRED"
].map((name) => [id(name), name]));

function unavailable(fail) {
  const reject = async () => { throw fail(); };
  return {
    hospitalSigner: reject,
    isMedicalStaff: reject,
    isEmergencyResponder: reject,
    hasAccess: reject,
    checkEmergencyAccess: reject,
    emergencyCooldown: reject,
    listConsent: reject,
    listEmergency: reject,
    listAudit: reject
  };
}

function createConsentReads({ provider, registryAddress, signerAddress, fail }) {
  if (!provider) return unavailable(fail);
  let scopePromise = null;

  async function scope() {
    if (!scopePromise) {
      scopePromise = resolveScope().catch((error) => {
        scopePromise = null;
        throw error;
      });
    }
    return scopePromise;
  }

  async function resolveScope() {
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== SEPOLIA_CHAIN_ID || getAddress(registryAddress) !== getAddress(SEPOLIA.registry)) {
      throw fail();
    }
    const records = new Contract(SEPOLIA.medicalRecords, [
      "function recordAccess() view returns (address)",
      "function emergencyAccess() view returns (address)",
      "function patientRegistry() view returns (address)",
      "function auditLog() view returns (address)"
    ], provider);
    const [accessAddress, emergencyAddress, patientRegistry, auditAddress] = await Promise.all([
      records.recordAccess(),
      records.emergencyAccess(),
      records.patientRegistry(),
      records.auditLog()
    ]);
    if (
      getAddress(accessAddress) !== getAddress(SEPOLIA.recordAccess)
      || getAddress(emergencyAddress) !== getAddress(SEPOLIA.emergency)
      || getAddress(patientRegistry) !== getAddress(SEPOLIA.registry)
      || getAddress(auditAddress) !== getAddress(SEPOLIA.auditLog)
    ) throw fail();
    const deployment = await provider.getTransactionReceipt(SEPOLIA.recordAccessTx);
    return {
      access: new Contract(SEPOLIA.recordAccess, [
        "function hasAccess(bytes32 patientRef, address account) view returns (bool)",
        "function getAccessExpiry(bytes32 patientRef, address account) view returns (uint256)",
        "event AccessGranted(bytes32 indexed patientRef, address indexed authorizedAddress, address indexed grantedBy, uint256 expiresAt)"
      ], provider),
      emergency: new Contract(SEPOLIA.emergency, [
        "function checkEmergencyAccess(bytes32 patientRef, address doctor) view returns (bool)",
        "event EmergencyAccessGranted(bytes32 indexed patientRef, address indexed doctor, bytes32 reasonHash, uint256 expiresAt)"
      ], provider),
      audit: new Contract(SEPOLIA.auditLog, [
        "event AuditRecorded(uint256 indexed entryId, address indexed actor, bytes32 indexed subject, bytes32 actionCode, uint256 timestamp, bool success)"
      ], provider),
      fromBlock: deployment?.blockNumber ?? 0
    };
  }

  async function roleManager() {
    const registry = new Contract(registryAddress, ["function roleManager() view returns (address)"], provider);
    const address = await registry.roleManager();
    return new Contract(address, [
      "function isMedicalStaff(address account) view returns (bool)",
      "function isEmergencyResponder(address account) view returns (bool)"
    ], provider);
  }

  return {
    async hospitalSigner() {
      return getAddress(signerAddress);
    },
    async isMedicalStaff(account) {
      return (await roleManager()).isMedicalStaff(account);
    },
    async isEmergencyResponder(account) {
      return (await roleManager()).isEmergencyResponder(account);
    },
    async hasAccess(patientRef, account) {
      return (await scope()).access.hasAccess(patientRef, account);
    },
    async checkEmergencyAccess(patientRef, account) {
      return (await scope()).emergency.checkEmergencyAccess(patientRef, account);
    },
    async emergencyCooldown(patientRef, account) {
      const sessions = await this.listEmergency(patientRef);
      return sessions.some((session) => getAddress(session.wallet) === getAddress(account) && session.cooldownActive);
    },
    async listConsent(patientRef) {
      const { access, fromBlock } = await scope();
      const granted = await access.queryFilter(access.filters.AccessGranted(patientRef), fromBlock);
      const wallets = [...new Set(granted.map((event) => getAddress(event.args.authorizedAddress)))];
      const now = Math.floor(Date.now() / 1000);
      const permissions = [];
      for (const wallet of wallets) {
        const active = await access.hasAccess(patientRef, wallet);
        let expiresAt = null;
        try {
          const expiry = await access.getAccessExpiry(patientRef, wallet);
          expiresAt = expiry === 0n ? null : Number(expiry);
        } catch {
          expiresAt = null;
        }
        permissions.push({
          wallet,
          active: Boolean(active),
          expiresAt,
          status: active ? "active" : (expiresAt && now >= expiresAt ? "expired" : "revoked")
        });
      }
      return permissions;
    },
    async listEmergency(patientRef) {
      const { emergency, fromBlock } = await scope();
      const granted = await emergency.queryFilter(emergency.filters.EmergencyAccessGranted(patientRef), fromBlock);
      const latest = new Map();
      for (const event of granted) {
        latest.set(getAddress(event.args.doctor), {
          wallet: getAddress(event.args.doctor),
          reasonHash: event.args.reasonHash,
          expiresAt: Number(event.args.expiresAt)
        });
      }
      const now = Math.floor(Date.now() / 1000);
      const sessions = [];
      for (const row of latest.values()) {
        const active = await emergency.checkEmergencyAccess(patientRef, row.wallet);
        const cooldownEndsAt = row.expiresAt + EMERGENCY_MAX_SECONDS;
        sessions.push({
          wallet: row.wallet,
          reasonHash: row.reasonHash,
          expiresAt: row.expiresAt,
          cooldownEndsAt,
          cooldownActive: now < cooldownEndsAt,
          active: Boolean(active),
          status: active ? "active" : (now >= row.expiresAt ? "expired" : "revoked")
        });
      }
      return sessions;
    },
    async listAudit(patientRef) {
      const { audit, fromBlock } = await scope();
      const logs = await audit.queryFilter(audit.filters.AuditRecorded(null, null, patientRef), fromBlock);
      return logs.flatMap((event) => {
        const action = AUDIT_ACTIONS[event.args.actionCode];
        if (!action) return [];
        return [{
          actor: getAddress(event.args.actor),
          action,
          timestamp: Number(event.args.timestamp),
          success: Boolean(event.args.success),
          source: "chain"
        }];
      });
    }
  };
}

module.exports = { createConsentReads, unavailable, SEPOLIA };
