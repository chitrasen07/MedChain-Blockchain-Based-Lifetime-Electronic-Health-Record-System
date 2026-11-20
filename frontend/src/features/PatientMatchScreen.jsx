import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, messageForRequest } from "../lib/api";
import { claimCommitmentForRecoveryCode, createRecoveryCode, sepoliaTransactionUrl } from "../lib/ownership";
import { pageChrome } from "../lib/pageChrome";
import { describeMatch, describeRegistration, emptyProfile, patientService, validateOwnership, validateProfile } from "../services/patientService";

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

function registrationLabel(phase) {
  if (phase === "submitting") return "Submitting";
  if (phase === "pending") return "Awaiting confirmation";
  if (phase === "confirmed") return "Confirmed";
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
  const [profile, setProfile] = useState(emptyProfile);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [match, setMatch] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [phase, setPhase] = useState("");
  const [ownershipMode, setOwnershipMode] = useState("claim");
  const [controller, setController] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [claimCommitment, setClaimCommitment] = useState("");
  const [recoverySaved, setRecoverySaved] = useState(false);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

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
      setMatch(await patientService.match(parsed.profile));
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

  async function onRegister() {
    const parsed = validateProfile(profile, { reviewCase: true });
    const ownership = validateOwnership({ mode: ownershipMode, controller, claimCommitment, recoverySaved });
    setErrors({ ...parsed.errors, ...ownership.errors });
    if (Object.keys(parsed.errors).length || Object.keys(ownership.errors).length || match?.status !== "no_match") return;
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
        setProfile(emptyProfile());
        setMatch(null);
        setRecoverySaved(false);
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
      setBusy("");
    }
  }

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      <form className="space-y-4" onSubmit={onMatch} noValidate>
        <Card title="Patient profile" description="Names and contact details are sent only for this request. They are not stored in this browser.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" name="fullName" value={profile.fullName} error={errors.fullName} autoComplete="name" onChange={(event) => change("fullName", event.target.value)} />
            <Input label="Date of birth" name="dateOfBirth" type="date" value={profile.dateOfBirth} error={errors.dateOfBirth} onChange={(event) => change("dateOfBirth", event.target.value)} />
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
                hint="Optional. Use this only after a different-person decision, and only when the match is no match."
                onChange={(event) => change("reviewCaseId", event.target.value)}
              />
            ) : null}
          </div>
          {canRegister ? (
            <div className="mt-5 border-t border-line pt-4">
              <Select label="Patient ownership" name="ownershipMode" value={ownershipMode} onChange={(event) => setOwnershipMode(event.target.value)}>
                <option value="claim">No wallet yet — recovery code</option>
                <option value="wallet">Patient wallet address</option>
              </Select>
              {ownershipMode === "wallet" ? (
                <Input
                  className="mt-4"
                  label="Patient wallet"
                  name="controller"
                  value={controller}
                  error={errors.controller}
                  hint="The patient controls this wallet. The hospital does not receive its key."
                  onChange={(event) => setController(event.target.value.trim())}
                />
              ) : (
                <div className="mt-4">
                  <div className="flex flex-col gap-2 sm:flex-row">
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
              <Button type="button" variant="secondary" onClick={onRegister} loading={busy === "register"} disabled={Boolean(busy) || match?.status !== "no_match"}>
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
          <StatusBadge tone={registrationTone(phase)}>{registrationLabel(phase)}</StatusBadge>
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
