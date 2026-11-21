import {
  ClipboardList,
  FileSearch,
  Fingerprint,
  FlaskConical,
  GitCompare,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  NotebookPen,
  Search,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";

export const workspaces = {
  administrator: {
    id: "administrator",
    title: "Hospital Admin",
    base: "/admin",
    pending: false,
    nav: [
      { label: "Overview", to: "/admin", end: true, icon: LayoutDashboard },
      { label: "Patient Registration", to: "/admin/registration", icon: UserPlus },
      { label: "Patient Matching", to: "/admin/matching", icon: GitCompare },
      { label: "Review Cases", to: "/admin/reviews", icon: ClipboardList },
      { label: "Staff Management", to: "/admin/staff", icon: Users },
      { label: "Change password", to: "/admin/password", icon: KeyRound },
    ],
  },
  doctor: {
    id: "doctor",
    title: "Doctor",
    base: "/doctor",
    pending: false,
    nav: [
      { label: "Overview", to: "/doctor", end: true, icon: Stethoscope },
      { label: "Patient Lookup", to: "/doctor/lookup", icon: Search },
      { label: "Visit References", to: "/doctor/visits", icon: FileSearch },
      { label: "Clinical records", to: "/doctor/records", icon: ClipboardList },
      { label: "Review intake", to: "/doctor/review", icon: FlaskConical },
      { label: "Emergency access", to: "/doctor/emergency", icon: ShieldCheck },
      { label: "Change password", to: "/doctor/password", icon: KeyRound },
    ],
  },
  receptionist: {
    id: "receptionist",
    title: "Receptionist",
    base: "/receptionist",
    pending: false,
    nav: [
      { label: "Overview", to: "/receptionist", end: true, icon: LayoutDashboard },
      { label: "Patient Matching", to: "/receptionist/matching", icon: GitCompare },
      { label: "Patient Lookup", to: "/receptionist/lookup", icon: Search },
      { label: "Change password", to: "/receptionist/password", icon: KeyRound },
    ],
  },
  staff: {
    id: "staff",
    title: "Hospital Staff",
    base: "/staff",
    pending: false,
    nav: [
      { label: "Overview", to: "/staff", end: true, icon: LayoutDashboard },
      { label: "Register Patient", to: "/staff/registration", icon: UserPlus },
      { label: "Patient Lookup", to: "/staff/lookup", icon: Search },
      { label: "Record Vitals", to: "/staff/vitals", icon: HeartPulse },
      { label: "Visit Notes", to: "/staff/notes", icon: NotebookPen },
      { label: "Lab Reports", to: "/staff/labs", icon: FlaskConical },
      { label: "Work Queue", to: "/staff/queue", icon: ListTodo },
      { label: "Visit References", to: "/staff/visits", icon: FileSearch },
      { label: "Clinical records", to: "/staff/records", icon: ClipboardList },
      { label: "Emergency access", to: "/staff/emergency", icon: ShieldCheck },
      { label: "Change password", to: "/staff/password", icon: KeyRound },
    ],
  },
  reviewer: {
    id: "reviewer",
    title: "Reviewer",
    base: "/reviewer",
    pending: false,
    nav: [
      { label: "Overview", to: "/reviewer", end: true, icon: LayoutDashboard },
      { label: "Review Queue", to: "/reviewer/queue", icon: ClipboardList },
      { label: "Patient Matching", to: "/reviewer/matching", icon: GitCompare },
      { label: "Change password", to: "/reviewer/password", icon: KeyRound },
    ],
  },
  patient: {
    id: "patient",
    title: "Patient",
    base: "/patient",
    pending: false,
    nav: [
      { label: "Dashboard", to: "/patient", end: true, icon: LayoutDashboard },
      { label: "Health identity", to: "/patient/identity", icon: Fingerprint },
      { label: "Ownership", to: "/patient/ownership", icon: KeyRound },
      { label: "Visit history", to: "/patient/history", icon: ClipboardList },
      { label: "Health record", to: "/patient/chart", icon: ClipboardList },
      { label: "Medical records", to: "/patient/records", icon: FileSearch },
      { label: "Access", to: "/patient/access", icon: ShieldCheck },
      { label: "Profile", to: "/patient/profile", icon: UserRound },
    ],
  },
  emergency: {
    id: "emergency",
    title: "Emergency Staff",
    base: "/emergency",
    pending: true,
    nav: [{ label: "Overview", to: "/emergency", end: true, icon: LayoutDashboard }],
  },
};

export const pages = {
  "admin-overview": {
    eyebrow: "Hospital Admin",
    title: "Overview",
    description:
      "Hospital administration for staff accounts, patient registration, and duplicate-match review.",
    kind: "overview",
    items: [
      {
        title: "Hospital staff directory",
        text: "Create receptionist, doctor, reviewer, and hospital staff accounts, or disable an account in this hospital.",
        to: "/admin/staff",
      },
      {
        title: "Patient registration",
        text: "Register a patient when matching does not find a confirmed record. The clinical profile stays off-chain.",
        to: "/admin/registration",
      },
      {
        title: "Matching and review",
        text: "Hold possible duplicate matches for a reviewer or administrator before a new registration is sent to the chain.",
        to: "/admin/reviews",
      },
      {
        title: "Hospital boundary",
        text: "The API scopes staff, patients, visits, and reviews to the signed-in hospital.",
      },
    ],
  },
  "admin-registration": {
    eyebrow: "Hospital Admin",
    title: "Patient Registration",
    description:
      "Check for a confirmed match, then register with the patient's Sepolia wallet. That is the recommended path and allows immediate sign-in. Registration without a wallet remains available and requires a later ownership claim.",
    kind: "table",
    columns: [
      { key: "patientId", header: "Patient ID" },
      { key: "status", header: "Blockchain registration status" },
      { key: "transaction", header: "Transaction" },
    ],
    emptyTitle: "No registration in progress",
    emptyDescription: "Registration will be available after the API is connected. This table is empty on purpose.",
  },
  "admin-matching": {
    eyebrow: "Hospital Admin",
    title: "Patient Matching",
    description:
      "Compare a profile with confirmed patients in this hospital. The API returns high confidence, possible match, or no match. It does not return a guarantee against duplicates.",
    kind: "table",
    columns: [
      { key: "status", header: "Result" },
      { key: "patientId", header: "Patient ID" },
      { key: "candidates", header: "Candidates" },
    ],
    emptyTitle: "No match has been run",
    emptyDescription: "Run a match to compare this profile with confirmed patients in the hospital.",
  },
  "admin-reviews": {
    eyebrow: "Hospital Admin",
    title: "Review Cases",
    description:
      "Pending duplicate-match cases for this hospital. A decision can mark the same person, a different person, or a rejection. The review response does not include the profile.",
    kind: "table",
    columns: [
      { key: "case", header: "Case" },
      { key: "status", header: "Status" },
      { key: "candidates", header: "Candidates" },
    ],
    emptyTitle: "No pending cases",
    emptyDescription: "This hospital has no pending review cases.",
  },
  "admin-staff": {
    eyebrow: "Hospital Admin",
    title: "Hospital Staff Directory",
    description:
      "List accounts in this hospital, create a receptionist, doctor, reviewer, or hospital staff account, disable an account, or assign a clinical wallet role on Sepolia.",
    kind: "table",
    columns: [
      { key: "email", header: "Email" },
      { key: "role", header: "Role" },
      { key: "status", header: "Status" },
    ],
    emptyTitle: "No staff accounts",
    emptyDescription: "This hospital has no staff accounts to show.",
  },
  "doctor-overview": {
    eyebrow: "Doctor",
    title: "Overview",
    description:
      "Lookup, encrypted clinical entries, and emergency requests for this hospital. Sepolia broadcasts stay disabled until they are approved.",
    kind: "overview",
    items: [
      {
        title: "Patient lookup",
        text: "Retrieve a confirmed patient by ID. The response returns identifiers and status.",
        to: "/doctor/lookup",
      },
      {
        title: "Clinical records",
        text: "Add a diagnosis, prescription, allergy, treatment, visit, or vital sign, correct it with a new version, and anchor the hash when consent and the Doctor role are present.",
        to: "/doctor/records",
      },
      {
        title: "Emergency access",
        text: "Prepare a time-limited request. The reason stays off-chain, and the public transaction is not sent from this screen.",
        to: "/doctor/emergency",
      },
    ],
  },
  "doctor-lookup": {
    eyebrow: "Doctor",
    title: "Patient lookup",
    description:
      "Open a confirmed patient's chart. Demographics and clinical entries stay encrypted and require consent or emergency access.",
    kind: "table",
    columns: [
      { key: "patientId", header: "Patient ID" },
      { key: "did", header: "DID" },
      { key: "status", header: "Status" },
    ],
    emptyTitle: "No patient selected",
    emptyDescription: "Enter a patient ID to read the identifier, DID, status, and creation time.",
  },
  "doctor-records": {
    eyebrow: "Doctor",
    title: "Clinical records",
    description:
      "Store a diagnosis, prescription, laboratory report, allergy, treatment, or visit for a confirmed patient. The text stays encrypted off-chain.",
    kind: "table",
    columns: [],
    emptyTitle: "No clinical entries",
    emptyDescription: "Entries appear after they are saved for this patient.",
  },
  "staff-records": {
    eyebrow: "Hospital Staff",
    title: "Clinical records",
    description:
      "Store an encrypted clinical entry for a confirmed patient in this hospital. Chain anchoring stays disabled without patient consent.",
    kind: "table",
    columns: [],
    emptyTitle: "No clinical entries",
    emptyDescription: "Entries appear after they are saved for this patient.",
  },
  "doctor-visits": {
    eyebrow: "Doctor",
    title: "Clinical Visit Reference",
    description:
      "Attach a visit reference, and optionally a record hash, to a confirmed patient. This screen does not write a medical record onto the blockchain.",
    kind: "table",
    columns: [
      { key: "visit", header: "Visit" },
      { key: "patientId", header: "Patient ID" },
      { key: "reference", header: "Reference" },
    ],
    emptyTitle: "No visit references",
    emptyDescription: "Submit a reference to store it with the patient. There is no visit list endpoint.",
  },
  "receptionist-overview": {
    eyebrow: "Receptionist",
    title: "Overview",
    description:
      "Front-desk tools for matching a profile and looking up a confirmed patient. This workspace cannot register a patient or manage staff.",
    kind: "overview",
    items: [
      {
        title: "Patient Matching",
        text: "Check whether a profile already matches a confirmed patient in this hospital.",
      },
      {
        title: "Patient lookup",
        text: "Open a confirmed patient by ID and read the identifier, DID, and status.",
      },
      {
        title: "Registration stays with admin",
        text: "A new blockchain registration is an administrator action.",
      },
    ],
  },
  "receptionist-matching": {
    eyebrow: "Receptionist",
    title: "Patient Matching",
    description:
      "Staff can submit a profile for matching. A possible match creates a review case instead of a blockchain registration.",
    kind: "table",
    columns: [
      { key: "status", header: "Result" },
      { key: "patientId", header: "Patient ID" },
      { key: "review", header: "Review" },
    ],
    emptyTitle: "No match has been run",
    emptyDescription: "Run a match before deciding whether a reviewer should see the profile.",
  },
  "receptionist-lookup": {
    eyebrow: "Receptionist",
    title: "Patient lookup",
    description: "Look up a confirmed patient by ID within the signed-in hospital.",
    kind: "table",
    columns: [
      { key: "patientId", header: "Patient ID" },
      { key: "did", header: "DID" },
      { key: "status", header: "Status" },
    ],
    emptyTitle: "No patient selected",
    emptyDescription: "Enter a patient ID from this hospital.",
  },
  "staff-overview": {
    eyebrow: "Hospital Staff",
    title: "Overview",
    description:
      "Register a patient with the patient's own wallet, record nursing intake, and follow the work queue. Diagnosis, review, and Sepolia anchoring stay with the doctor.",
    kind: "overview",
    items: [
      {
        title: "Register a patient",
        text: "Use the patient's MetaMask signature. Walletless registration remains available, and staff cannot sign for the patient.",
        to: "/staff/registration",
      },
      {
        title: "Nursing intake",
        text: "Record vitals, a visit note, or a structured laboratory report. Each one stays pending until a doctor reviews it.",
        to: "/staff/vitals",
      },
      {
        title: "Work queue",
        text: "See recent registrations and pending reviews without the clinical text.",
        to: "/staff/queue",
      },
    ],
  },
  "staff-registration": {
    eyebrow: "Hospital Staff",
    title: "Register Patient",
    description:
      "Check for a confirmed match, then register with the patient's Sepolia wallet. The patient signs the wallet link. Staff cannot sign on the patient's behalf. Registration without a wallet remains available.",
    kind: "table",
    columns: [],
    emptyTitle: "No registration in progress",
    emptyDescription: "Choose a registration method after matching.",
  },
  "staff-vitals": {
    eyebrow: "Hospital Staff",
    title: "Record Vitals",
    description: "Enter the measurements taken for a confirmed patient. They are encrypted and marked Pending doctor review.",
    kind: "table",
    columns: [],
    emptyTitle: "No vitals",
    emptyDescription: "Saved measurements appear after you load the patient.",
  },
  "staff-notes": {
    eyebrow: "Hospital Staff",
    title: "Visit Notes",
    description: "Record check-in time, the visit reason, symptoms, and nursing observations for doctor review.",
    kind: "table",
    columns: [],
    emptyTitle: "No visit notes",
    emptyDescription: "Saved notes appear after you load the patient.",
  },
  "staff-labs": {
    eyebrow: "Hospital Staff",
    title: "Lab Reports",
    description: "Enter a structured laboratory report. It stays Pending doctor review until a doctor approves or rejects it.",
    kind: "table",
    columns: [],
    emptyTitle: "No laboratory reports",
    emptyDescription: "Saved reports appear after you load the patient.",
  },
  "staff-queue": {
    eyebrow: "Hospital Staff",
    title: "Work Queue",
    description: "Recent registrations, pending laboratory reviews, visit tasks, and vital signs. Clinical text is not shown in the queue.",
    kind: "table",
    columns: [],
    emptyTitle: "Queue is clear",
    emptyDescription: "Pending work for this hospital appears here.",
  },
  "doctor-review": {
    eyebrow: "Doctor",
    title: "Review intake",
    description: "Read nurse-submitted vitals, visit notes, and laboratory reports after the consented clinical wallet is connected. Approve a report into the chart or reject it. Anchoring stays a separate MetaMask step.",
    kind: "table",
    columns: [],
    emptyTitle: "No intake",
    emptyDescription: "Pending reports appear after a patient is loaded.",
  },
  "staff-lookup": {
    eyebrow: "Hospital Staff",
    title: "Patient lookup",
    description: "Find a confirmed patient by lifetime Patient ID. The page shows registration details, permitted demographics, and nursing visit information. Doctor diagnoses stay on the consented chart.",
    kind: "table",
    columns: [
      { key: "patientId", header: "Patient ID" },
      { key: "did", header: "DID" },
      { key: "status", header: "Status" },
    ],
    emptyTitle: "No patient selected",
    emptyDescription: "Enter a patient ID from this hospital.",
  },
  "staff-visits": {
    eyebrow: "Hospital Staff",
    title: "Clinical Visit Reference",
    description:
      "Store a visit reference for a confirmed patient. Optional hashes stay with the visit record off-chain.",
    kind: "table",
    columns: [
      { key: "visit", header: "Visit" },
      { key: "patientId", header: "Patient ID" },
      { key: "reference", header: "Reference" },
    ],
    emptyTitle: "No visit references",
    emptyDescription: "Submit a reference to store it off-chain with the patient. There is no visit list endpoint.",
  },
  "reviewer-overview": {
    eyebrow: "Reviewer",
    title: "Overview",
    description:
      "Reviewers resolve ambiguous patient matches and can run matching. They cannot create staff accounts.",
    kind: "overview",
    items: [
      {
        title: "Review Queue",
        text: "Open pending cases for this hospital. Responses omit demographic fields and encrypted profiles.",
      },
      {
        title: "Decisions",
        text: "Mark the same person, a different person, or reject the case. A different-person decision can later be registered by an administrator.",
      },
      {
        title: "Matching",
        text: "Run a match before a case exists. A possible match opens a review instead of a chain registration.",
      },
    ],
  },
  "reviewer-queue": {
    eyebrow: "Reviewer",
    title: "Review Queue",
    description: "Pending review cases for this hospital. Open a case to record same person, different person, or reject.",
    kind: "table",
    columns: [
      { key: "case", header: "Case" },
      { key: "status", header: "Status" },
      { key: "candidates", header: "Candidates" },
    ],
    emptyTitle: "No pending cases",
    emptyDescription: "This hospital has no pending review cases.",
  },
  "reviewer-matching": {
    eyebrow: "Reviewer",
    title: "Patient Matching",
    description: "Run a hospital-scoped match. Possible matches become review cases and are not registered on-chain from the match itself.",
    kind: "table",
    columns: [
      { key: "status", header: "Result" },
      { key: "patientId", header: "Patient ID" },
      { key: "review", header: "Review" },
    ],
    emptyTitle: "No match has been run",
    emptyDescription: "Run a match. A possible match becomes a review case and is not registered from this screen.",
  },
  "doctor-emergency": {
    eyebrow: "Doctor",
    title: "Emergency access",
    description:
      "Request temporary access for a confirmed patient. The wallet must be an on-chain emergency responder, and the reason is not published.",
    kind: "table",
    columns: [],
    emptyTitle: "No emergency session",
    emptyDescription: "A session appears only after the chain reports one.",
  },
  "staff-emergency": {
    eyebrow: "Hospital Staff",
    title: "Emergency access",
    description:
      "Request temporary access for a confirmed patient. The chain accepts only an emergency responder, for at most 72 hours.",
    kind: "table",
    columns: [],
    emptyTitle: "No emergency session",
    emptyDescription: "A session appears only after the chain reports one.",
  },
  patient: {
    eyebrow: "Patient",
    title: "Patient workspace",
    description:
      "Patient sign-in uses a wallet signature. Consent is granted by the controller wallet, and public networks are not sent a transaction.",
    kind: "overview",
    items: [],
  },
  emergency: {
    eyebrow: "Emergency Staff",
    title: "Emergency workspace",
    description:
      "There is no separate emergency login. Signed-in doctors and hospital staff prepare a request from their own workspace.",
    kind: "pending",
    pendingTitle: "Use a clinical workspace",
    pendingMessage:
      "This page does not request emergency access and does not send a transaction. An authorized clinician prepares the request after signing in.",
  },
};
