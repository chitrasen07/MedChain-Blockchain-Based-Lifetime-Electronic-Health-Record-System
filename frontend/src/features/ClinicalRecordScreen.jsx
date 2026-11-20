import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, messageForRequest } from "../lib/api";
import { sepoliaTransactionUrl } from "../lib/ownership";
import { pageChrome } from "../lib/pageChrome";
import { CLINICAL_FIELDS, clinicalRequestBody, clinicalService } from "../services/clinicalService";

const CATEGORY_LABELS = {
  diagnosis: "Diagnosis",
  prescription: "Prescription",
  laboratory: "Laboratory report",
  allergy: "Allergy",
  treatment: "Treatment",
  visit: "Hospital visit",
};

const emptyFields = () => ({});

export function ClinicalRecordScreen({ pageKey }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [patientId, setPatientId] = useState("");
  const [category, setCategory] = useState("diagnosis");
  const [recordedOn, setRecordedOn] = useState("");
  const [fields, setFields] = useState(emptyFields);
  const [priorRecordId, setPriorRecordId] = useState("");
  const [records, setRecords] = useState([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  async function load(id) {
    setLoading(true);
    setNotice("");
    try {
      const result = await clinicalService.list(id);
      setRecords(result.records || []);
    } catch (error) {
      setRecords([]);
      setNotice(error instanceof ApiError && error.status === 404
        ? "No confirmed patient with that ID was found in this hospital."
        : error instanceof ApiError
          ? messageForRequest(error)
          : "The hospital service could not complete the request.");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const id = patientId.trim().toUpperCase();
    const body = clinicalRequestBody({ category, recordedOn, fields, priorRecordId });
    const missing = (CLINICAL_FIELDS[category] || []).filter(([name, , required]) => required && !body.fields[name]);
    if (!/^PATIENT-[0-9]{1,12}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(recordedOn) || missing.length) {
      setNotice("Enter the patient ID, the date, and the required clinical fields.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await clinicalService.create(id, body);
      setFields(emptyFields());
      setPriorRecordId("");
      await load(id);
    } catch (error) {
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The hospital service could not complete the request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      <form onSubmit={onSubmit} noValidate>
        <Card
          title="Clinical entry"
          description="The entry is encrypted in the hospital database. The hash is not anchored, because the hospital wallet cannot grant or bypass patient consent."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Patient ID" name="patientId" value={patientId} onChange={(event) => setPatientId(event.target.value)} placeholder="PATIENT-000001" />
            <Input label="Recorded on" name="recordedOn" type="date" value={recordedOn} onChange={(event) => setRecordedOn(event.target.value)} />
            <Select label="Category" value={category} onChange={(event) => { setCategory(event.target.value); setFields(emptyFields()); }}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Select label="Version" value={priorRecordId} onChange={(event) => setPriorRecordId(event.target.value)}>
              <option value="">New record</option>
              {records.map((record) => (
                <option key={record.id} value={record.id}>
                  Version of {CATEGORY_LABELS[record.category] || record.category} · {record.recordedOn}
                </option>
              ))}
            </Select>
            {(CLINICAL_FIELDS[category] || []).map(([name, label, required]) => (
              <Input
                key={name}
                label={required ? label : `${label} (optional)`}
                name={name}
                value={fields[name] || ""}
                onChange={(event) => setFields((current) => ({ ...current, [name]: event.target.value }))}
              />
            ))}
          </div>
          {notice ? <p role="alert" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={() => load(patientId.trim().toUpperCase())} loading={loading} disabled={loading || saving}>
              Load history
            </Button>
            <Button type="submit" loading={saving} disabled={loading || saving}>Save encrypted entry</Button>
            <Button type="button" variant="secondary" disabled>
              Anchor on chain
            </Button>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">Anchoring stays disabled. A consented medical-staff wallet must submit the hash. This screen does not use the hospital signing key.</p>
        </Card>
      </form>
      <Card className="mt-4" title="Stored entries">
        {records.length === 0 ? (
          <EmptyState title="No clinical entries" description="Load a patient to see encrypted entries already stored for this hospital. Nothing is invented here." />
        ) : (
          <ol className="space-y-5 border-l border-line pl-5">
            {records.map((record) => {
              const explorer = sepoliaTransactionUrl(record.transaction);
              return (
                <li key={record.id} className="relative">
                  <span className="absolute top-1.5 -left-[1.45rem] h-2.5 w-2.5 rounded-full bg-teal" aria-hidden="true" />
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-navy">{CATEGORY_LABELS[record.category] || record.category}</p>
                    <StatusBadge tone="warning">Consent required</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{record.recordedOn} · version {record.versionIndex}</p>
                  <p className="mt-2 text-sm leading-6 text-ink">{Object.entries(record.content || {}).filter(([key]) => key !== "category" && key !== "recordedOn").map(([, value]) => value).join(" · ")}</p>
                  <p className="mt-1 break-all text-xs text-muted">{record.contentHash}</p>
                  {explorer ? <a className="mt-1 inline-flex break-all text-xs text-teal" href={explorer} target="_blank" rel="noreferrer">{record.transaction}</a> : null}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
