import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { ApiError, messageForRequest } from "../lib/api";
import { pageChrome } from "../lib/pageChrome";
import { patientService } from "../services/patientService";

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function PatientLookupScreen({ pageKey }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [patientId, setPatientId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [patient, setPatient] = useState(null);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  async function onSubmit(event) {
    event.preventDefault();
    const id = patientId.trim();
    if (!id) {
      setError("Enter the patient ID.");
      setPatient(null);
      return;
    }
    setError("");
    setNotice("");
    setLoading(true);
    try {
      setPatient(await patientService.get(id));
    } catch (requestError) {
      setPatient(null);
      setNotice(
        requestError instanceof ApiError && requestError.status === 404
          ? "No confirmed patient with that ID was found in this hospital."
          : requestError instanceof ApiError
            ? messageForRequest(requestError)
            : "The hospital service could not complete the request.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      <form onSubmit={onSubmit} noValidate>
        <Card title="Find a confirmed patient">
          <Input label="Patient ID" name="patientId" value={patientId} error={error} onChange={(event) => setPatientId(event.target.value)} />
          {notice ? <p role="alert" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
          <Button className="mt-4" type="submit" loading={loading} disabled={loading}>Look up</Button>
        </Card>
      </form>
      {patient ? (
        <Card className="mt-4" title="Patient reference">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Patient ID</dt>
              <dd className="mt-1 break-all text-ink">{patient.patientId}</dd>
            </div>
            <div>
              <dt className="text-muted">DID</dt>
              <dd className="mt-1 break-all text-ink">{patient.did}</dd>
            </div>
            <div>
              <dt className="text-muted">Registration status</dt>
              <dd className="mt-1 text-ink">{patient.status}</dd>
            </div>
            <div>
              <dt className="text-muted">Created</dt>
              <dd className="mt-1 text-ink">{formatTimestamp(patient.createdAt)}</dd>
            </div>
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
