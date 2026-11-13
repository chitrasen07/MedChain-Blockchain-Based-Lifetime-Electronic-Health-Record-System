# MedChain frontend

Hospital interface for MedChain. This phase is the visual foundation only.

Clinical data is not shown. Sign-in does not call the API. Workspace routes are layout shells, not authenticated sessions. There is no role switcher.

## Run

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

Production build:

```bash
npm run build
npm run preview
```

## Configuration

Copy `.env.example` to `.env` when a later phase connects the API.

```text
VITE_API_URL=http://localhost:3000
```

Do not put backend secrets, private keys, or database credentials in this folder.

## Routes

| Path | What it is |
| --- | --- |
| `/` | Welcome |
| `/login` | Staff login form. It does not sign anyone in. |
| `/unauthorized` | Access message. Role checks are not active. |
| `/admin` | Hospital Admin shell |
| `/doctor` | Doctor shell |
| `/receptionist` | Receptionist shell |
| `/staff` | Hospital Staff shell |
| `/reviewer` | Reviewer shell |
| `/patient` | Future patient shell. Backend role does not exist. |
| `/emergency` | Future emergency shell. Backend role does not exist. |

Navigation inside each shell matches the current backend responsibilities. Patient and emergency pages state that backend integration is pending.
