# MedChain

MedChain keeps a lifetime patient record in PostgreSQL and uses Ethereum only
for opaque references, identity commitments, record hashes, permissions, and
audit codes. Names, contact details, clinical text, and recovery secrets stay
off the chain.

## Architecture

- `frontend/` is the React staff application. Staff sign in against the API.
  The administrator registration screen can supply a patient wallet or a
  browser-generated ownership recovery code. Only the claim commitment is sent
  to the API.
- `backend/` is the Express API. It encrypts profiles, matches identity hashes,
  and submits patient registration through the Sepolia `PatientRegistry`.
- `blockchain/` contains the six Solidity contracts, local tests, and
  `scripts/deploy.js`. The deployed Sepolia addresses are in
  `blockchain/deployments/sepolia.json`.

Application roles are administrator, doctor, receptionist, hospital staff, and
reviewer. Chain roles are separate and are not assigned by an API login.

## Local setup

1. Install PostgreSQL and create an application database and role. Do not commit
   the password.
2. Copy `backend/.env.example` to `backend/.env`. Set `DATABASE_URL`,
   `JWT_SECRET`, `BOOTSTRAP_SECRET`, `IDENTITY_COMMITMENT_KEY`, and a 64-hex
   `PII_ENCRYPTION_KEY`.
3. From `backend/`:

   ```bash
   npm install
   npm run migrate
   npm test
   npm start
   ```

   Migrations `001` through `005` are applied in filename order. A changed
   applied migration is rejected. `BLOCKCHAIN_ENABLED=false` starts the API
   without a wallet. Registration then returns HTTP 503 and writes nothing.
4. Copy `frontend/.env.example` to `frontend/.env` with
   `VITE_API_URL=http://localhost:3000`. From `frontend/`:

   ```bash
   npm install
   npm test
   npm run dev
   ```

   Open `http://localhost:5173`.
5. Contract tests and a local node run from `blockchain/`:

   ```bash
   npm install
   npx hardhat test
   npx hardhat node
   npx hardhat run scripts/deploy.js --network localhost
   ```

   Local compilation does not require Sepolia credentials.

## Sepolia

The hardened contracts are already deployed. Use the addresses in
`blockchain/deployments/sepolia.json`. Do not redeploy them and do not use
mainnet.

Enabled mode requires `RPC_URL`, `PATIENT_REGISTRY_ADDRESS`, and
`BLOCKCHAIN_PRIVATE_KEY` for the hospital-administrator signer. Patient
controllers are supplied per registration. There is no shared controller.
Keep the signer key in `backend/.env`, which is gitignored.

A registration stores an opaque `bytes32` reference on-chain and allocates
`PATIENT-######` in PostgreSQL. A patient without a wallet is registered with
a claim commitment. The recovery secret is generated in the browser and is not
stored by the API.

## Implemented behavior

- Staff authentication, hospital-scoped roles, and one-time bootstrap.
- Patient matching, review, and administrator registration.
- Append-only record hashes, consent grants by the patient controller, and
  time-bounded emergency access in the contracts.
- Duplicate identity commitments return HTTP 409 and are not submitted again.
- An unknown submission that already has a transaction hash stays on that hash.
- Confirmed registrations show the lifetime ID, opaque reference, transaction
  hash, and a Sepolia Etherscan link.
- Patients sign in with a one-time wallet signature checked against the Sepolia
  controller. A recovery code is checked in the browser and is not sent to the
  API. The portal does not submit the on-chain claim on a public network.
- Doctors and hospital staff can store encrypted diagnoses, prescriptions,
  laboratory reports, allergies, treatments, and visits. The patient portal
  shows that patient's own timeline. Record hashes are not anchored by the
  hospital wallet, and consent cannot be granted by an administrator.

## Tests

From `blockchain/`, `npx hardhat test` runs 42 local contract tests. From
`backend/`, `npm test` runs 44 tests. From `frontend/`, `npm test` runs 15
tests, `npm run lint` runs oxlint, and `npm run build` creates the production
bundle.

## Limits

The API does not yet call the access, emergency, or medical-record contracts.
Chain roles are not issued from staff login. A lost controller cannot be
recovered unless that controller stored a recovery commitment beforehand.
Logout does not revoke a token before its 15-minute expiry. Patient and
emergency workspaces have no API role.
