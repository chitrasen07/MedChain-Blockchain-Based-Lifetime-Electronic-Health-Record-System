import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { DataTable } from "../components/DataTable";
import { ErrorState } from "../components/ErrorState";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { ApiError, messageForRequest } from "../lib/api";
import { pageChrome } from "../lib/pageChrome";
import { rememberResolvedReview } from "../services/patientService";
import { describeDecision, reviewService, validateDecision } from "../services/reviewService";

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function requestMessage(error) {
  if (error instanceof ApiError && error.status === 404) return "That review case was not found in this hospital.";
  return error instanceof ApiError ? messageForRequest(error) : "The hospital service could not complete the request.";
}

export function ReviewQueueScreen({ pageKey }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [cases, setCases] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [detail, setDetail] = useState(null);
  const [decision, setDecision] = useState("same_patient");
  const [candidatePatientId, setCandidatePatientId] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [outcome, setOutcome] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  async function load() {
    setLoadError("");
    try {
      const result = await reviewService.list();
      setCases(Array.isArray(result?.cases) ? result.cases : []);
    } catch (error) {
      setCases([]);
      setLoadError(requestMessage(error));
    }
  }

  useEffect(() => {
    let active = true;
    reviewService.list().then((result) => {
      if (active) setCases(Array.isArray(result?.cases) ? result.cases : []);
    }).catch((error) => {
      if (!active) return;
      setCases([]);
      setLoadError(requestMessage(error));
    });
    return () => {
      active = false;
    };
  }, []);

  async function openCase(id) {
    setNotice("");
    setOutcome("");
    setErrors({});
    setNotes("");
    try {
      const next = await reviewService.get(id);
      setDetail(next);
      const first = Array.isArray(next?.candidateIds) ? next.candidateIds[0] || "" : "";
      setCandidatePatientId(first);
      setDecision("same_patient");
    } catch (error) {
      setDetail(null);
      setNotice(requestMessage(error));
    }
  }

  function askToDecide(event) {
    event.preventDefault();
    const parsed = validateDecision({ decision, candidatePatientId, notes }, detail?.candidateIds || []);
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length) return;
    setConfirming(true);
  }

  async function submitDecision() {
    const parsed = validateDecision({ decision, candidatePatientId, notes }, detail?.candidateIds || []);
    if (Object.keys(parsed.errors).length || !detail) return;
    setPending(true);
    setNotice("");
    try {
      const caseId = detail.id;
      const result = await reviewService.decide(caseId, parsed.body);
      if (result?.registrationRequired) rememberResolvedReview(result.reviewCaseId || caseId);
      setOutcome(describeDecision({ ...result, reviewCaseId: result?.reviewCaseId || caseId }));
      setNotes("");
      setConfirming(false);
      setDetail(null);
      await load();
    } catch (error) {
      setConfirming(false);
      setNotice(requestMessage(error));
    } finally {
      setPending(false);
    }
  }

  const rows = (cases || []).map((item) => ({
    id: item.id,
    caseId: item.id,
    status: item.status,
    candidates: item.candidateCount,
    opened: formatTimestamp(item.createdAt),
    action: (
      <Button size="sm" variant="secondary" onClick={() => openCase(item.id)}>
        Open
      </Button>
    ),
  }));

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      <Card flush title="Pending cases">
        {cases === null ? <div className="px-5 py-4"><LoadingSkeleton label="Loading review cases" /></div> : null}
        {loadError ? (
          <div className="px-5 py-4">
            <ErrorState title="Review queue unavailable" message={loadError} action={<Button onClick={load}>Try again</Button>} />
          </div>
        ) : null}
        {cases && !loadError ? (
          <DataTable
            columns={[
              { key: "caseId", header: "Case" },
              { key: "status", header: "Status" },
              { key: "candidates", header: "Candidates" },
              { key: "opened", header: "Opened" },
              { key: "action", header: "Action" },
            ]}
            rows={rows}
            emptyTitle="No pending cases"
            emptyDescription="This hospital has no pending review cases."
          />
        ) : null}
      </Card>
      {detail ? (
        <form className="mt-4" onSubmit={askToDecide} noValidate>
          <Card title="Case detail" description="Identifiers only. The profile is not included in this response.">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Case</dt>
                <dd className="mt-1 break-all text-ink">{detail.id}</dd>
              </div>
              <div>
                <dt className="text-muted">Status</dt>
                <dd className="mt-1 text-ink">{detail.status}</dd>
              </div>
              <div>
                <dt className="text-muted">Opened</dt>
                <dd className="mt-1 text-ink">{formatTimestamp(detail.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted">New record</dt>
                <dd className="mt-1 break-all text-ink">{detail.newPatientId || "None"}</dd>
              </div>
            </dl>
            <div className="mt-4 grid gap-4">
              <Select label="Decision" value={decision} error={errors.decision} onChange={(event) => setDecision(event.target.value)}>
                <option value="same_patient">Same person</option>
                <option value="different_person">Different person</option>
                <option value="reject">Reject</option>
              </Select>
              {decision === "same_patient" ? (
                <Select label="Candidate" value={candidatePatientId} error={errors.candidatePatientId} onChange={(event) => setCandidatePatientId(event.target.value)}>
                  {(detail.candidateIds || []).map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </Select>
              ) : null}
              <label className="block text-sm font-medium text-ink">
                Notes
                <textarea
                  value={notes}
                  maxLength={1000}
                  onChange={(event) => setNotes(event.target.value)}
                  className="mt-1.5 min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink focus:border-teal focus:ring-2 focus:ring-teal/20"
                />
                {errors.notes ? <span className="mt-1.5 block text-xs font-normal text-danger">{errors.notes}</span> : <span className="mt-1.5 block text-xs font-normal text-muted">Optional. Up to 1,000 characters.</span>}
              </label>
            </div>
            {notice ? <p role="alert" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
            <Button className="mt-4" type="submit" disabled={detail.status !== "pending"}>Record decision</Button>
          </Card>
        </form>
      ) : null}
      {outcome ? <p role="status" className="mt-4 rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-6 text-ink">{outcome}</p> : null}
      <ConfirmationDialog
        open={confirming}
        title="Record this decision?"
        description="This updates the review case for this hospital. It does not submit a blockchain transaction."
        confirmLabel="Record decision"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={submitDecision}
      />
    </div>
  );
}
