import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { ApiError, messageForRequest } from "../lib/api";
import { pageChrome } from "../lib/pageChrome";
import { describeMatch, describeRegistration, emptyProfile, patientService, validateProfile } from "../services/patientService";

function requestMessage(error) {
  return error instanceof ApiError ? messageForRequest(error) : "The hospital service could not complete the request.";
}

export function PatientMatchScreen({ pageKey, canRegister = false }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [profile, setProfile] = useState(emptyProfile);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [match, setMatch] = useState(null);
  const [registration, setRegistration] = useState(null);

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

  async function onRegister() {
    const parsed = validateProfile(profile, { reviewCase: true });
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length || match?.status !== "no_match") return;
    setBusy("register");
    setNotice("");
    try {
      const result = await patientService.register(parsed.profile, parsed.reviewCaseId);
      setRegistration(result);
      setProfile(emptyProfile());
      setMatch(null);
    } catch (error) {
      if (error instanceof ApiError && error.resultStatus === "registration_failed") {
        setNotice(describeRegistration(null, error));
        setProfile(emptyProfile());
        setMatch(null);
      } else {
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
      {registration ? (
        <Card className="mt-4" title="Registration status">
          <p className="text-sm leading-6 text-ink">{describeRegistration(registration)}</p>
          {registration.transaction ? <p className="mt-2 break-all text-sm leading-6 text-muted">Transaction {registration.transaction}</p> : null}
        </Card>
      ) : null}
    </div>
  );
}
