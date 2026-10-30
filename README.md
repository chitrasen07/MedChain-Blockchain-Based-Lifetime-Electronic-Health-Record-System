# MedChain

MedChain is a blockchain integrity and permissions layer for a lifetime
electronic health record system. Clinical data and demographic details remain
off-chain.

## Architecture

- [`blockchain/`](./blockchain) contains the Hardhat Solidity contracts,
  deployment scripts, and contract tests.
- [`backend/`](./backend) contains the authorized Node.js/Express API,
  PostgreSQL migration, encrypted profile storage, matching, audit metadata,
  and the server-side `PatientRegistry` adapter.
- No frontend is present in this repository yet.

The backend never accepts government identifiers. It stores the patient profile
encrypted with an application key and stores keyed HMACs of normalized fields
for matching. A stable identity commitment is sent to the existing registry
only by the backend signer; raw names, dates of birth, contact details, and
medical records are not sent on-chain.

## Local setup

1. Install PostgreSQL 14 or newer and create an application database and
   least-privilege application role. For a local installation:

   ```sql
   CREATE ROLE medchain LOGIN PASSWORD 'set-this-outside-source-control';
   CREATE DATABASE medchain OWNER medchain;
   ```

   Do not use this sample password outside a local setup, and do not commit it.
2. Copy `backend/.env.example` to `backend/.env`, fill in `DATABASE_URL` and
   the other placeholders using a secret manager or local-only file.
3. Install and migrate the backend:

   ```bash
   cd backend
   npm install
   npm run migrate
   npm test
   npm start
   ```

   `npm run migrate` discovers numbered SQL files, applies them in order inside
   one transaction, records checksums in `schema_migrations`, and refuses to
   run if an applied migration was changed. The migration requires permission
   to create the `pgcrypto` extension for UUID generation; a database
   administrator may install it once with `CREATE EXTENSION pgcrypto` if the
   application role cannot do so.

   Migration `004_registration_transactions.sql` stores lifecycle metadata,
   transaction hashes, and contract-returned identifiers. It does not make
   PostgreSQL and blockchain operations atomic.

4. For the local chain, use the commands in [`blockchain/README.md`](./blockchain/README.md)
   and set `RPC_URL`, `PATIENT_REGISTRY_ADDRESS`, `BLOCKCHAIN_PRIVATE_KEY`,
   and `CONTROLLER_ADDRESS` to an authorized local deployment account/address.
   Run the read-only signer diagnostic:

   ```bash
   npm run diagnose:signer
   ```

   It verifies the configured signer, registry, connected `RoleManager`, and
   hospital-admin role without printing the private key or changing on-chain
   permissions. If it fails, manually verify the deployment addresses and
   assign the role through an already authorized administrator.

Required secrets are `JWT_SECRET`, `IDENTITY_COMMITMENT_KEY`, and
`PII_ENCRYPTION_KEY` (64 hex characters). Do not commit `.env` files or real
patient data. Rotate identity and encryption keys through an approved key
management process; this initial implementation does not provide key rotation
or cross-hospital federation.

## API

- `GET /health` and `GET /ready` (`503 Service unavailable` when PostgreSQL is
  unreachable)
- `POST /auth/token`
- `POST /auth/bootstrap` (one-time, protected by `BOOTSTRAP_SECRET`; creates
  the first hospital and administrator)
- `GET /admin/users` (hospital administrator only)
- `POST /admin/users` (hospital administrator only; creates receptionist,
  doctor, reviewer, or hospital staff accounts in the administrator's hospital)
- `POST /admin/users/:id/disable` (hospital administrator only)
- `POST /patients/match` (authenticated staff)
- `POST /patients` (administrator; high-confidence matches reuse the existing
  Patient ID, possible matches create a review case, and only no-match or
  approved different-person requests reach `PatientRegistry`)
- `GET /patients/:patientId` (authenticated staff)
- `POST /patients/:patientId/visits` (authenticated staff)
- `POST /review-cases/:id/decision` (reviewer or administrator; accepts
  `same_patient`, `different_person`, or `reject`)
- `GET /review-cases` and `GET /review-cases/:id` (reviewer or administrator)

User authentication checks the current database status on every request, so
disabling a user invalidates previously issued tokens. Patient, visit, review,
and user queries include the authenticated user's hospital boundary. Migration
`002_hospital_authorization.sql` adds the hospitals table, active/disabled
statuses, reviewer role, and hospital foreign-key relationships without
editing migration `001_initial.sql`.

Matching returns `high_confidence`, `possible_match`, or `no_match`; it does
not guarantee duplicate prevention. Possible matches are stored in migration
`003_matching_review_workflow.sql` as hospital-scoped review cases. Candidate
references are internal UUIDs; review responses do not include encrypted
profiles or demographic fields. A pending case cannot submit a blockchain
registration. Reviewers can link the request to an existing patient, reject
it, or mark it as a different person; the latter reuses the pending request for
the subsequent authorized registration.

The review transaction uses a database row lock and a hospital/request
fingerprint uniqueness constraint so repeated decisions are idempotent and
concurrent ambiguous requests share one pending case. Database and blockchain
operations are still not atomic.

Registration lifecycle states are `submitting`, `submitted`, `confirmed`,
`failed`, and `unknown`. A database claim in `submitting` prevents concurrent
requests from submitting duplicate transactions. The backend persists the transaction hash before waiting for a
receipt. A later request reconciles the original hash and event before any
retry. Unknown attempts are not blindly resubmitted; if the commitment is
already present on-chain, manual reconciliation is required.

Recovery procedure:

1. Inspect the registration row and original transaction hash.
2. Query the configured RPC for the original receipt.
3. If `PatientRegistered` is present, let the backend reconciliation path
   confirm the row.
4. If the receipt reverted, verify commitment state and deployment before an
   administrator-approved retry.
5. If no hash was persisted after a process crash, do not resubmit until the
   commitment and deployment state have been checked.

## Tests

Run blockchain tests with `npm test` from `blockchain/` (the current suite has
42 passing tests). Run backend unit tests with `npm test` from `backend/`.
