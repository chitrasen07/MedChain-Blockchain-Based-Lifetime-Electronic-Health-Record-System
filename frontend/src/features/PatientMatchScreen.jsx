import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, messageForRequest } from "../lib/api";
import { claimCommitmentForRecoveryCode, createRecoveryCode, sepoliaTransactionUrl } from "../lib/ownership";
import { connectPatientWallet, ensurePatientSepolia, signPatientLogin } from "../lib/patientWallet";
import { pageChrome } from "../lib/pageChrome";
import { clearRegistrationDraft, describeMatch, describeRegistration, emptyProfile, loadRegistrationDraft, patientService, registrationReady, saveRegistrationDraft, validateOwnership, validateProfile } from "../services/patientService";

function requestMessage(error) {
  return error instanceof ApiError ? messageForRequest(error) : "The hospital service could not complete the request.";
}

function pendingRegistration(result) {
  return ["registration_submitted", "registration_pending", "registration_submission_in_progress"].includes(result?.status);
}

function registrationTone(phase) {
  if (phase === "confirmed") return "success";
  if (phase === "pending" || phase === "submitting" || phase === "uncertain") return "warning";
  if (phase === "duplicate" || phase === "failed") return "danger";
  return "info";
}

function registrationLabel(phase, mode) {
  if (phase === "submitting") return "Submitting";
  if (phase === "pending") return "Awaiting confirmation";
  if (phase === "confirmed") return mode === "wallet" ? "Registered — Wallet linked" : "Registered — Wallet linking pending";
  if (phase === "duplicate") return "Duplicate identity";
  if (phase === "failed") return "Failed";
  if (phase === "uncertain") return "Needs reconciliation";
  return "Registration";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadRecoveryCode(recoveryCode) {
  const text = [
    "MedChain ownership recovery code",
    "",
    "Keep this code with the patient. The hospital does not store it.",
    "It is required later to claim a wallet for this record.",
    "",
    `Recovery code: ${recoveryCode}`,
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "medchain-ownership-recovery-code.txt";
  link.click();
  URL.revokeObjectURL(url);
}

export function PatientMatchScreen({ pageKey, canRegister = false }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [profile, setProfile] = useState(() => loadRegistrationDraft() || emptyProfile());
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [match, setMatch] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [phase, setPhase] = useState("");
  const [ownershipMode, setOwnershipMode] = useState("claim");
  const registerLock = useRef(false);
  const [controller, setController] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [claimCommitment, setClaimCommitment] = useState("");
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [walletProof, setWalletProof] = useState(null);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  useEffect(() => {
    saveRegistrationDraft(profile);
  }, [profile]);

  function change(field, value) {
    setProfile((current) => ({ ...current, [field]: value }));
    setNotice("");
    if (field !== "reviewCaseId") {
      setMatch(null);
      setRegistration(null);
    }
  }

  async function onMatch(event) {
    event.preventDefault();
    const parsed = validateProfile(profile, { reviewCase: canRegister });
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length) return;
    setBusy("match");
    setNotice("");
    setRegistration(null);
    try {
      const result = await patientService.match(parsed.profile, parsed.reviewCaseId);
      setMatch(result);
      if (result?.reviewCaseId && (result.status === "review_authorized" || result.status === "review_required")) {
        setProfile((current) => ({ ...current, reviewCaseId: result.reviewCaseId }));
      }
    } catch (error) {
      setMatch(null);
      setNotice(requestMessage(error));
    } finally {
      setBusy("");
    }
  }

  function generateRecoveryCode() {
    const code = createRecoveryCode();
    setRecoveryCode(code);
    setClaimCommitment(claimCommitmentForRecoveryCode(code));
    setRecoverySaved(false);
    setErrors((current) => ({ ...current, claimCommitment: undefined, recoverySaved: undefined }));
  }

  function walletNotice(error, fallback) {
    if (error?.code === 4001 || error?.code === "wallet_rejected") return error.message || "MetaMask did not approve the request. No transaction was sent.";
    return error?.message || fallback;
  }

  async function connectWallet() {
    setBusy("wallet");
    setNotice("");
    try {
      await ensurePatientSepolia();
      setController(await connectPatientWallet());
      setWalletProof(null);
      setNotice("The patient wallet is connected on Sepolia. Ask them to sign the one-time wallet link. Registration has not been sent.");
    } catch (error) {
      setNotice(walletNotice(error, "The wallet could not be connected. No transaction was sent."));
    } finally {
      setBusy("");
    }
  }

  async function signWalletLink() {
    setBusy("sign");
    setNotice("");
    try {
      await ensurePatientSepolia();
      const challenge = await patientService.walletChallenge(controller);
      const signature = await signPatientLogin(challenge.message, controller);
      setWalletProof({ nonce: challenge.nonce, signature });
      setNotice("The patient signed the wallet link. It can be used once. Registration has not been sent.");
    } catch (error) {
      setWalletProof(null);
      setNotice(error instanceof ApiError ? requestMessage(error) : walletNotice(error, "The wallet link could not be signed. No transaction was sent."));
    } finally {
      setBusy("");
    }
  }

  async function onRegister() {
    if (registerLock.current) return;
    const parsed = validateProfile(profile, { reviewCase: true });
    const ownership = validateOwnership({ mode: ownershipMode, controller, claimCommitment, recoverySaved, walletProof });
    setErrors({ ...parsed.errors, ...ownership.errors });
    if (Object.keys(parsed.errors).length || Object.keys(ownership.errors).length || !registrationReady(match)) return;
    registerLock.current = true;
    setBusy("register");
    setNotice("");
    setPhase("submitting");
    try {
      let result = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        result = await patientService.register(parsed.profile, parsed.reviewCaseId, ownership.ownership);
        setRegistration(result);
        if (!pendingRegistration(result)) break;
        setPhase("pending");
        await wait(4000);
      }
      const confirmed = Boolean(result?.patientId && result?.did && !pendingRegistration(result) && result.status !== "registration_reconciliation_required");
      setPhase(confirmed ? "confirmed" : result?.status === "registration_reconciliation_required" ? "uncertain" : pendingRegistration(result) ? "pending" : result?.status || "confirmed");
      if (confirmed) {
        setRecoveryCode("");
        clearRegistrationDraft();
        setProfile(emptyProfile());
        setMatch(null);
        setRecoverySaved(false);
        setWalletProof(null);
        setController("");
        setClaimCommitment("");
        setNotice(ownershipMode === "wallet"
          ? "Registered — Wallet linked. The patient can sign in now with the same wallet. The hospital wallet was not used as the owner."
          : "Registered — Wallet linking pending. Give the patient this Patient ID and the recovery code. They connect their own wallet, check the code, announce the claim, wait for the contract period, reveal it, and then sign in. No second Patient ID is created.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && messageForRequest(error).includes("identity commitment")) {
        setPhase("duplicate");
        setRegistration(null);
        setNotice(messageForRequest(error));
      } else if (error instanceof ApiError && error.resultStatus === "registration_failed") {
        setPhase("failed");
        setRegistration(null);
        setNotice(describeRegistration(null, error));
      } else {
        setPhase("");
        setNotice(requestMessage(error));
      }
    } finally {
      registerLock.current = false;
      setBusy("");
    }
  }

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      <form className="space-y-4" onSubmit={onMatch} noValidate>
        <Card title="Patient profile" description="These registration fields stay in this browser until the patient is confirmed. The recovery code is not saved.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" name="fullName" value={profile.fullName} error={errors.fullName} autoComplete="name" onChange={(event) => change("fullName", event.target.value)} />
            <Input label="Date of birth" name="dateOfBirth" type="date" value={profile.dateOfBirth} error={errors.dateOfBirth} onChange={(event) => change("dateOfBirth", event.target.value)} />
            <Input label="Gender (optional)" name="gender" value={profile.gender || ""} onChange={(event) => change("gender", event.target.value)} />
            <Input label="Blood group (optional)" name="bloodGroup" value={profile.bloodGroup || ""} onChange={(event) => change("bloodGroup", event.target.value)} />
            <Input label="Mobile" name="mobile" value={profile.mobile} error={errors.mobile} hint="Optional" autoComplete="tel" onChange={(event) => change("mobile", event.target.value)} />
            <Input label="Email" name="email" type="email" value={profile.email} error={errors.email} hint="Optional" autoComplete="email" onChange={(event) => change("email", event.target.value)} />
            <Input className="sm:col-span-2" label="Emergency contact" name="emergencyContact" value={profile.emergencyContact} error={errors.emergencyContact} hint="Optional" onChange={(event) => change("emergencyContact", event.target.value)} />
            {canRegister ? (
              <Input
                className="sm:col-span-2"
                label="Resolved review case"
                name="reviewCaseId"
                value={profile.reviewCaseId}
                error={errors.reviewCaseId}
                hint="Use the case ID after a different-person decision. Check for a match again. Pending, rejected, mismatched, and already-used cases cannot register."
                onChange={(event) => change("reviewCaseId", event.target.value)}
              />
            ) : null}
          </div>
          {canRegister ? (
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-sm font-medium text-ink">Choose one registration method</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Registration method">
                <button
                  type="button"
                  role="radio"
                  aria-checked={ownershipMode === "claim"}
                  className={`rounded-xl border px-4 py-3 text-left ${ownershipMode === "claim" ? "border-teal ring-1 ring-teal" : "border-line bg-canvas"}`}
                  onClick={() => setOwnershipMode("claim")}
                >
                  <span className="block text-sm font-semibold text-navy">Register now, link wallet later <span className="font-medium text-teal-dark">Default</span></span>
                  <span className="mt-1 block text-xs leading-5 text-muted">Creates the lifetime Patient ID without a wallet. The patient later claims ownership with their own MetaMask and the recovery code. The hospital wallet is not the owner.</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={ownershipMode === "wallet"}
                  className={`rounded-xl border px-4 py-3 text-left ${ownershipMode === "wallet" ? "border-teal ring-1 ring-teal" : "border-line bg-canvas"}`}
                  onClick={() => setOwnershipMode("wallet")}
                >
                  <span className="block text-sm font-semibold text-navy">Register and link the patient's wallet now</span>
                  <span className="mt-1 block text-xs leading-5 text-muted">The patient connects their own MetaMask on Sepolia and signs the one-time link. Staff wallets cannot be used as the patient owner.</span>
                </button>
              </div>
              {ownershipMode === "wallet" ? (
                <div className="mt-4">
                  <p className="break-all text-sm leading-6 text-ink">{controller || "No wallet connected."}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">Ask the patient to connect their own wallet. Do not use the hospital, doctor, nurse, receptionist, or reviewer wallet. This page does not sign for them.</p>
                  {errors.controller ? <p className="mt-1.5 text-xs leading-5 text-danger">{errors.controller}</p> : null}
                  {errors.walletProof ? <p className="mt-1.5 text-xs leading-5 text-danger">{errors.walletProof}</p> : null}
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="secondary" onClick={connectWallet} loading={busy === "wallet"} disabled={Boolean(busy)}>Connect patient wallet</Button>
                    <Button type="button" variant="secondary" onClick={signWalletLink} loading={busy === "sign"} disabled={Boolean(busy) || !controller}>Sign wallet link</Button>
                  </div>
                  {walletProof ? <p className="mt-2 text-xs leading-5 text-muted">Wallet link signed. It can be used once.</p> : null}
                </div>
              ) : (
                <div className="mt-4">
                  <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-xs leading-5 text-ink">After registration, the status is Registered — Wallet linking pending. The patient uses this Patient ID on the sign-in page: connect their wallet, check the recovery code, announce, wait for the contract period, reveal, then sign in. Missing the reveal window blocks that claim until it expires.</p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="secondary" onClick={generateRecoveryCode}>Generate recovery code</Button>
                    {recoveryCode ? (
                      <>
                        <Button type="button" variant="secondary" onClick={() => navigator.clipboard?.writeText(recoveryCode)}>Copy code</Button>
                        <Button type="button" variant="secondary" onClick={() => downloadRecoveryCode(recoveryCode)}>Download code</Button>
                      </>
                    ) : null}
                  </div>
                  {recoveryCode ? (
                    <p className="mt-3 break-all rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs leading-5 text-ink">{recoveryCode}</p>
                  ) : null}
                  <p className="mt-2 text-xs leading-5 text-muted">Only a commitment is sent to the hospital. The recovery code stays with the patient.</p>
                  {errors.claimCommitment ? <p className="mt-1.5 text-xs leading-5 text-danger">{errors.claimCommitment}</p> : null}
                  <label className="mt-3 flex items-start gap-2 text-sm leading-6 text-ink">
                    <input className="mt-1" type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} />
                    <span>The recovery code has been saved with the patient.</span>
                  </label>
                  {errors.recoverySaved ? <p className="mt-1.5 text-xs leading-5 text-danger">{errors.recoverySaved}</p> : null}
                </div>
              )}
            </div>
          ) : null}
          {notice ? <p role="alert" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button type="submit" loading={busy === "match"} disabled={Boolean(busy)}>Check for a match</Button>
            {canRegister ? (
              <Button type="button" variant="secondary" onClick={onRegister} loading={busy === "register"} disabled={Boolean(busy) || !registrationReady(match)}>
                Register patient
              </Button>
            ) : null}
          </div>
        </Card>
      </form>
      {match ? (
        <Card className="mt-4" title="Match result">
          <p className="text-sm leading-6 text-ink">{describeMatch(match)}</p>
          {match.status === "high_confidence" && match.patient?.did ? <p className="mt-2 text-sm leading-6 text-muted">DID {match.patient.did}</p> : null}
          {match.reviewCaseId ? <p className="mt-2 break-all text-sm leading-6 text-muted">Review case {match.reviewCaseId}</p> : null}
          {Number.isInteger(match.candidateCount) ? <p className="mt-2 text-sm leading-6 text-muted">Candidates {match.candidateCount}</p> : null}
        </Card>
      ) : null}
      {phase ? (
        <Card className="mt-4" title="Registration status">
          <StatusBadge tone={registrationTone(phase)}>{registrationLabel(phase, ownershipMode)}</StatusBadge>
          <p className="mt-3 text-sm leading-6 text-ink">{phase === "duplicate" || phase === "failed" ? notice : describeRegistration(registration)}</p>
          {registration?.patientId ? <p className="mt-3 text-sm leading-6 text-ink">Lifetime patient ID <span className="font-medium">{registration.patientId}</span></p> : null}
          {registration?.did ? <p className="mt-2 break-all text-sm leading-6 text-muted">Blockchain reference {registration.did}</p> : null}
          {registration?.transaction ? <p className="mt-2 break-all text-sm leading-6 text-muted">Transaction {registration.transaction}</p> : null}
          {sepoliaTransactionUrl(registration?.transaction) ? (
            <a className="mt-3 inline-flex text-sm font-medium text-teal-dark underline" href={sepoliaTransactionUrl(registration.transaction)} target="_blank" rel="noreferrer">
              View on Sepolia Etherscan
            </a>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
