# MedChain Blockchain Layer

Smart contracts for a lifetime electronic health record **integrity and permission** layer.

Clinical data stays off-chain. The chain stores identifiers, cryptographic hashes, permissions, timestamps, and audit events only.

## Contracts

| Contract | File | Responsibility |
| --- | --- | --- |
| `RoleManager` | `contracts/RoleManager.sol` | Hospital roles on OpenZeppelin AccessControl |
| `PatientRegistry` | `contracts/PatientRegistry.sol` | Patient ID, DID/reference, controller wallet, active flag |
| `RecordAccessControl` | `contracts/AccessControl.sol` | Permanent or time-limited record access grants |
| `EmergencyAccess` | `contracts/EmergencyAccess.sol` | Temporary emergency access with mandatory expiry |
| `MedicalRecordRegistry` | `contracts/MedicalRecordRegistry.sol` | Record hash registration and verification |
| `AuditLog` | `contracts/AuditLog.sol` | Append-only audit entries |

`RecordAccessControl` is the contract name in `AccessControl.sol` so it does not collide with OpenZeppelin `AccessControl`.

## Why medical data is not stored on-chain

A public or consortium ledger is replicated. Names, diagnoses, prescriptions, and documents must not be written to it. These contracts store:

- `patientId` / DID references
- controller and staff wallet addresses
- `bytes32` hashes of off-chain records and emergency reason references
- permission windows and timestamps
- audit action names and resource IDs

## Record hashing

Off-chain record (backend later):

```text
SHA-256(canonical record bytes) → bytes32 recordHash
```

On-chain:

1. `registerRecordHash(recordId, patientId, recordType, recordHash)`
2. Later `verifyRecordHash(recordId, submittedHash)`
3. Equal hashes ⇒ integrity OK; mismatch ⇒ the off-chain record changed

## Roles

`PATIENT`, `DOCTOR`, `NURSE`, `LAB_TECHNICIAN`, `PHARMACIST`, `SPECIALIST`, `HOSPITAL_ADMIN`, `AUDITOR`, `SUPER_ADMIN`

The deployer receives `SUPER_ADMIN`. Hospital admins may assign clinical and patient roles. Only `SUPER_ADMIN` may assign `HOSPITAL_ADMIN`, `AUDITOR`, or `SUPER_ADMIN`.

## Access control

The patient controller wallet or a hospital/super admin may `grantAccess` / `revokeAccess`.

- `expiresAt = 0` ⇒ permanent until revoked
- `expiresAt > now` ⇒ time-limited; `hasAccess` is false after expiry

Staff cannot grant themselves access.

## Emergency access

Authorized `DOCTOR`, `SPECIALIST`, or `NURSE` may request access with a **reason hash** and duration (1 second through 72 hours). There is no permanent emergency grant. `checkEmergencyAccess` returns false after expiry.

## Audit trail

Authorized system contracts append entries. There is no update or delete. Typical actions: `PATIENT_REGISTERED`, `RECORD_CREATED`, `RECORD_UPDATED`, `RECORD_VERIFIED`, `ACCESS_GRANTED`, `ACCESS_REVOKED`, `EMERGENCY_ACCESS_REQUESTED`, `EMERGENCY_ACCESS_GRANTED`, `EMERGENCY_ACCESS_REVOKED`, `PATIENT_DEACTIVATED`.

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

Do not use a public network until the rest of MedChain is ready.
