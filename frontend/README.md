# MedChain frontend

Staff interface for MedChain. Sign-in calls `POST /auth/token`. Each role is
limited to its own workspace.

## Run

```bash
cd frontend
npm install
npm test
npm run dev
```

Open `http://localhost:5173`.

Production build:

```bash
npm run lint
npm run build
```

## Configuration

Copy `.env.example` to `.env`.

```text
VITE_API_URL=http://localhost:3000
```

Do not put backend secrets, private keys, or database credentials in this folder.

## Routes

| Path | What it is |
| --- | --- |
| `/` | Welcome |
| `/login` | Staff sign-in |
| `/unauthorized` | Role restriction |
| `/admin` | Hospital administration, including patient registration |
| `/doctor` | Doctor workspace |
| `/receptionist` | Reception workspace |
| `/staff` | Hospital staff workspace |
| `/reviewer` | Review workspace |
| `/patient/login` | Patient wallet sign-in and recovery-code check |
| `/patient` | Patient dashboard, identity, ownership, visits, and profile |
| `/emergency` | Placeholder. The API has no emergency-staff login. |

Registration accepts either a patient wallet address or a recovery code
generated in the browser. The recovery secret is not included in the API
request. A confirmed registration links to Sepolia Etherscan.
