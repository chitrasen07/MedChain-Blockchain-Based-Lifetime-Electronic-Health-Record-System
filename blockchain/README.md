# MedChain Blockchain Layer

Smart contracts for a lifetime electronic health record **integrity and permission** layer.

Clinical data stays off-chain. The chain stores identifiers, cryptographic hashes, permissions, timestamps, and audit events only.

## Contracts

| Contract | File | Responsibility |
| --- | --- | --- |
| `RoleManager` | `contracts/RoleManager.sol` | Hospital roles on OpenZeppelin AccessControl |
| `PatientRegistry` | `contracts/PatientRegistry.sol` | Opaque patient reference, required identity commitment, individual or unclaimed controller |
| `RecordAccessControl` | `contracts/AccessControl.sol` | Permanent or time-limited record access grants |
| `EmergencyAccess` | `contracts/EmergencyAccess.sol` | Temporary emergency access with mandatory expiry |
| `MedicalRecordRegistry` | `contracts/MedicalRecordRegistry.sol` | Record hash registration and verification |
| `AuditLog` | `contracts/AuditLog.sol` | Append-only audit entries |

`RecordAccessControl` is the contract name in `AccessControl.sol` so it does not collide with OpenZeppelin `AccessControl`.

## Why medical data is not stored on-chain

A public or consortium ledger is replicated. Names, diagnoses, prescriptions, and documents must not be written to it. These contracts store:

- opaque `bytes32` patient and record references
- required `bytes32` identity, claim, recovery, and record-hash commitments
- controller and staff wallet addresses
- permission windows and timestamps
- fixed audit action codes

Sequential patient numbers, DIDs derived from those numbers, diagnosis categories, and free-text audit descriptions are not stored. Nothing in this list is confidential merely because a Solidity variable is private. Anyone who reads the chain can see it.

## Record hashing

Off-chain record (backend later):

```text
SHA-256(canonical record bytes) → bytes32 recordHash
```

On-chain:

1. `createRecord(recordRef, patientRef, recordHash, recordDate)`
2. Later `appendRecordVersion(recordRef, recordHash, recordDate)` keeps every earlier hash
3. `verifyRecordHash(recordRef, versionIndex, submittedHash)` checks one stored version

## Roles

`PATIENT`, `DOCTOR`, `NURSE`, `LAB_TECHNICIAN`, `PHARMACIST`, `SPECIALIST`, `HOSPITAL_ADMIN`, `AUDITOR`, `SUPER_ADMIN`

The deployer receives `SUPER_ADMIN`. Hospital admins may assign clinical and patient roles. Only `SUPER_ADMIN` may assign `HOSPITAL_ADMIN`, `AUDITOR`, or `SUPER_ADMIN`.

## Access control

The patient controller may `grantAccess` / `revokeAccess`. A hospital administrator cannot grant or revoke clinical access.

- `expiresAt = 0` means the grant lasts until the controller revokes it
- `expiresAt > now` means the grant ends at that time

## Patient registration and ownership

Hospital administrators call `registerPatient(bytes32 patientRef, address controller, bytes32 identityCommitment, bytes32 claimCommitment)`.

- `patientRef` is an opaque 32-byte reference generated off-chain. The chain does not issue `PATIENT-000001`.
- The friendly lifetime ID stays in PostgreSQL.
- `identityCommitment` is required. There is no registration path without one, and a commitment can belong to only one patient reference.
- Set `controller` to the patient's wallet and `claimCommitment` to zero when the patient has a wallet.
- Set `controller` to the zero address and `claimCommitment` to `keccak256(abi.encode(secret, CLAIM_DOMAIN))` when the patient has no wallet. The hospital never receives a wallet key and cannot later choose the controller.
- The patient later calls `announceControllerClaim` and, after one hour, `revealControllerClaim`. The secret and the claimant address are bound together, so a copied transaction cannot choose a different wallet.
- The current controller proposes a transfer. The new controller must accept it.
- Recovery uses the same delay. The controller sets `keccak256(abi.encode(secret, RECOVERY_DOMAIN))` in advance. Without that commitment, a lost controller cannot be replaced by the hospital.

Everything stored or emitted by these contracts is readable on the chain. Restricted getters and `private` variables do not make that data confidential. Personal details, clinical text, and the detailed audit trail stay off-chain.

## Emergency access

An authorized doctor, specialist, or nurse may open one break-glass grant with a reason hash and a duration from 1 second through 72 hours. The grant cannot be extended. The same responder cannot open another grant for that patient until 72 hours after the first grant's expiry, including when it is revoked early. Record changes require a current consent grant or a current emergency grant. The original author does not keep edit rights after that authorization ends.

## Record hashes

`createRecord` stores the first hash. `appendRecordVersion` adds another hash and leaves the earlier hash in place. There is no diagnosis or document field.

## Application roles and chain roles

The API roles are administrator, doctor, receptionist, hospital staff, and reviewer. The chain roles are the RoleManager values listed above. They are not assigned automatically from an API login. Receptionist, reviewer, and hospital staff have no chain role. A chain hospital administrator can register and deactivate patient references and can revoke emergency access. That role cannot grant consent or write a record hash.

## Audit trail

Authorized registry contracts append fixed action codes and opaque subjects. There is no update or delete. The deployer is not an audit writer. A super administrator can still authorize a logger, so that authority should be used only for the four registry contracts. The detailed audit record remains in PostgreSQL. On-chain entries are public.

## Architecture

```text
RoleManager
    └── AuditLog
            └── PatientRegistry
                    ├── RecordAccessControl
                    ├── EmergencyAccess
                    └── MedicalRecordRegistry
```

## Commands

From `blockchain/`:

```bash
npm install
npx hardhat compile
npx hardhat test
npx hardhat node
```

In another terminal:

```bash
npx hardhat run scripts/deploy.js --network localhost
```

### Remix VM deployment order

Deploy the contracts in this order, using the deployed addresses as constructor
arguments:

1. `RoleManager()` (no arguments)
2. `AuditLog(roleManagerAddress)`
3. `PatientRegistry(roleManagerAddress, auditLogAddress)`
4. `RecordAccessControl(roleManagerAddress, patientRegistryAddress, auditLogAddress)`
5. `EmergencyAccess(roleManagerAddress, patientRegistryAddress, auditLogAddress)`
6. `MedicalRecordRegistry(roleManagerAddress, patientRegistryAddress, recordAccessAddress, emergencyAccessAddress, auditLogAddress)`

Using the `SUPER_ADMIN` account from `RoleManager`, call
`AuditLog.setAuthorizedLogger(address, true)` for `PatientRegistry`,
`RecordAccessControl`, `EmergencyAccess`, and `MedicalRecordRegistry`. Assign the
`HOSPITAL_ADMIN` role before attempting patient registration.

The current Sepolia deployment is recorded in `deployments/sepolia.json`.
`scripts/deploy.js` accepts only local Hardhat (chain ID 31337) and Sepolia
(chain ID 11155111). Do not redeploy over that manifest and do not use mainnet.
