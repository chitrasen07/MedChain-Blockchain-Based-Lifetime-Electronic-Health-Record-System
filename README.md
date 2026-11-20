# MedChain

MedChain is a lifetime electronic health record system for one hospital. PostgreSQL holds the patient profile and the clinical chart. Ethereum stores only opaque references, commitments, record hashes, consent, emergency grants, and audit codes. Names, contact details, clinical text, and recovery secrets stay off the chain.

The Sepolia contracts are already deployed. This project does not redeploy them, and the interface does not broadcast a public transaction unless that broadcast has been approved.

## Features

- Staff sign-in for administrator, doctor, receptionist, hospital staff, and reviewer, each limited to one hospital.
- Patient matching, duplicate review, and administrator registration on Sepolia.
- A confirmed patient receives a lifetime ID such as `PATIENT-000001` and an opaque `bytes32` reference.
- Patient wallet sign-in with a one-time challenge. A recovery code is checked in the browser and is not sent to the API.
- Encrypted diagnoses, prescriptions, laboratory reports, allergies, treatments, and visits.
- Consent and emergency reads from the deployed contracts. Grants, revocations, claims, anchors, and emergency requests are prepared for the holder of the wallet.
- Append-only record hashes. A later version does not replace the earlier hash.
- Emergency access is limited to 72 hours, followed by a cooldown. During an emergency, the chart is limited to allergies, diagnoses, prescriptions, and laboratory results.

## Technology stack

- Frontend: React 19, React Router, Tailwind CSS 4, Vite
- Backend: Node.js, Express, Zod, JSON Web Tokens, PostgreSQL
- Chain: Solidity 0.8.24, OpenZeppelin AccessControl, Hardhat, ethers v6
- Network: Sepolia, chain ID `11155111`

## System architecture

```text
Browser (staff or patient wallet)
  -> Express API on port 3000
       -> PostgreSQL: profiles, visits, encrypted charts, audit reasons
       -> Sepolia, read-only eth_call for controller, consent, emergency, and audit
  -> MetaMask, only when a public transaction has been approved
       -> the six deployed contracts
```

The API signing wallet is the hospital administrator. It can register a patient reference. It cannot grant consent, request emergency access, or anchor a medical record. Those calls require the patient controller or a clinical wallet that already has consent or an active emergency grant.

## Database architecture

Migrations `001` through `008` are applied in filename order. An already applied file is not edited. The application role does not need permission to create a database.

| Area | What it stores |
| --- | --- |
| Hospitals and users | One hospital, staff email, scrypt password, role, and active status |
| Patients | Lifetime ID, opaque reference, status, encrypted profile |
| Registration transactions | Pending, confirmed, or failed registration and its transaction hash |
| Visits | Off-chain visit reference and optional hash |
| Review cases | Possible duplicate matches held before a new registration |
| Patient challenges | One-time wallet login nonces |
| Medical records | Encrypted clinical JSON, version, content hash, and chain status |
| Clinical wallet sessions | A staff member's proven wallet, kept for 15 minutes |
| Access audit | Encrypted emergency reason and its hash. The chain stores the hash only |

The current database has five staff accounts, one confirmed patient, and no medical-record rows.

## Blockchain architecture

Six contracts, compiled with optimizer runs of 200:

| Contract | Responsibility |
| --- | --- |
| RoleManager | Hospital and clinical roles |
| AuditLog | Append-only action codes. The text of an event stays off-chain |
| PatientRegistry | Opaque patient reference, identity commitment, and one controller |
| RecordAccessControl | Consent granted and revoked only by the patient controller |
| EmergencyAccess | One bounded emergency grant per responder, maximum 72 hours |
| MedicalRecordRegistry | Append-only record hashes. Clinical text is not an argument |

A record hash is `keccak256` of the UTF-8 stable JSON for that entry. The same clinical text always produces the same hash, and the hash does not contain the text.

An unclaimed patient is registered with a claim commitment. The patient later calls `announceControllerClaim`, waits one hour, and then calls `revealControllerClaim` from the same wallet. The reveal places the recovery secret in public transaction data, so that secret is burned once it is mined. Another wallet can replace a pending announcement after 25 hours.

## Smart contract addresses

Deployed on Sepolia. Source of record: `blockchain/deployments/sepolia.json`. Hospital administrator: `0xD272a1e1027CDCDeA3ebbB8A9D01977e2030547F`.

| Contract | Address |
| --- | --- |
| RoleManager | `0xDE4331A5D901B1aBBbE98B51F075e5D0A5894B78` |
| AuditLog | `0x85175F99DB99613DF7ce8452dd7C16eF475431B6` |
| PatientRegistry | `0xDe1501AF8BACc3c1040788AFb8d2f784Ab8e2806` |
| RecordAccessControl | `0xe520020bDBE95039697e93B4305cDCe7e682CEa6` |
| EmergencyAccess | `0x7c662d0649eDa6406Decd37020a2aD3ea811Fbd6` |
| MedicalRecordRegistry | `0x83A6DB7481E7037b9fBd063f14bE50097f8258Cd` |

Earlier addresses from the first deployment are incompatible and are not used.

## Installation

Requirements: Node.js, PostgreSQL, and a Sepolia RPC URL if registration is enabled.

1. Create a PostgreSQL database and a login role. Do not commit the password. The URL encoding for a reserved character in the password is the percent encoding used by `DATABASE_URL`.
2. Copy `backend/.env.example` to `backend/.env`. Set the database URL and the four random secrets. `PII_ENCRYPTION_KEY` is 64 hexadecimal characters. Put the hospital-administrator private key only in that gitignored file.
3. From `backend/`:

   ```bash
   npm install
   npm run migrate
   npm start
   ```

4. Copy `frontend/.env.example` to `frontend/.env`. Leave the local-contract variables unset.

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

5. Open `http://localhost:5173`. The API listens on port 3000. `CORS_ORIGIN` must be `http://localhost:5173` for this setup.

Contract tests, from `blockchain/`:

```bash
npm install
npx hardhat test
```

`npx hardhat test` uses the in-memory network. It does not need a Sepolia key and it does not send a public transaction. Do not run `scripts/deploy.js` against Sepolia again.

## Application workflow

1. An administrator signs in and creates the hospital staff accounts.
2. A receptionist or administrator matches a profile. A possible duplicate becomes a review case and is not registered.
3. When there is no match, an administrator registers the patient. The browser supplies either a controller wallet or a claim commitment. The recovery secret stays in the browser.
4. The API submits `registerPatient` with the hospital wallet, stores the lifetime ID, and shows the Sepolia transaction once it is confirmed.
5. The patient signs a one-time challenge. The API accepts it only when that wallet is the on-chain controller.
6. A doctor or hospital staff member connects a wallet and signs a challenge. The API reads consent and emergency state for that wallet before it decrypts a chart.
7. The patient prepares a grant or revocation. A clinician prepares an anchor or an emergency request. Those actions stay unsigned on Sepolia until a broadcast is approved.

## Demonstration

What can be shown with the current deployment:

- Staff sign-in and the workspace each role is allowed to open. Passwords are not stored in the repository.
- Patient registration states, including a duplicate identity commitment, which returns HTTP 409 and is not submitted again.
- Lookup of `PATIENT-000001`, its opaque reference, and the confirmed registration transaction on Sepolia Etherscan.
- The patient portal's empty chart, consent list, and the disabled public-send actions. This patient is still unclaimed, so that wallet cannot sign in or grant consent yet.
- A local Hardhat test of announce, the one-hour wait, reveal, consent, anchoring, revocation, and emergency cooldown.

What is not part of the demonstration:

- A Sepolia claim, consent grant, record anchor, or emergency transaction. Those were prepared and priced, then stopped for approval.
- A separate emergency-staff login. The request is made by a signed-in doctor or hospital staff member whose wallet has the on-chain role.

## Test results

The backend suite was run again after the production log change and remained 56 passing. The frontend unit tests and Hardhat suite were not repeated after the interface copy changes. The production build was run at the end of Phase 10.

| Suite | Result |
| --- | --- |
| `backend/` `npm test` | 56 passing |
| `frontend/` `npm test` | 20 passing |
| `frontend/` `npm run lint` | Clean |
| `blockchain/` `npx hardhat test` | 45 passing on the in-memory network |

The production build is run again at the end of Phase 10.

## Deployment

The API and the browser are separate processes. PostgreSQL must already exist before `npm run migrate`.

1. On a production host, set `CORS_ORIGIN` to the frontend origin only. An unset origin does not allow browser calls.
2. Keep `backend/.env` on the server. It is listed in `backend/.gitignore`. Do not copy it into the frontend.
3. Run `npm run migrate` once for each new migration. Do not drop the database to reapply an old file.
4. Start the API with `npm start` from `backend/`. Build the frontend with `npm run build` and serve `frontend/dist` over HTTPS.
5. Set `VITE_API_URL` to the public API origin before the build. Leave `VITE_LOCAL_*` unset so the built site cannot broadcast by accident.
6. Confirm `GET /health` returns `{"status":"ok"}`. Client errors return a short message. A server failure returns `Internal server error` and does not include the database URL or a stack trace.
7. The hospital private key stays on the API host. Patients and clinicians sign their own transactions in a wallet. Do not put those keys in the API.

A local demonstration uses the commands in Installation and does not need this hosting layout.

## Known limitations

- `PATIENT-000001` has no controller. Consent cannot be granted, and that patient cannot open the portal, until the one-hour claim is completed.
- The hospital wallet is an administrator, not a doctor, nurse, or emergency responder. Clinical wallets still need those roles on Sepolia.
- Logout clears the browser session. It does not revoke the token, which expires 15 minutes after sign-in.
- Chain roles are not assigned from the staff directory.
- No medical record has been anchored, so the interface has no Sepolia transaction link for a chart entry.
- The saved recovery value matches the stored commitment. It is not in the API database and must not be pasted into a chat or a public transaction until a reveal is approved.

## Future enhancements

- Approve and send the prepared Sepolia claim, role assignments, consent grant, anchor, and emergency request from the wallets that own them.
- Let a patient who has completed the claim sign in and see the resulting consent on the access page.
- Record the anchor transaction hash after a mined clinical-wallet transaction, and show its Etherscan link.
- Add server-side token revocation on sign-out.
