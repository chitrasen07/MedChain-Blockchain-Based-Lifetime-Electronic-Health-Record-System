import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, messageForRequest } from "../lib/api";
import { nursingBody, nursingIssues, vitalFields } from "../lib/nursingForm";
import { pageChrome } from "../lib/pageChrome";
import { nursingService } from "../services/nursingService";

const COPY = {
  vital: {
    title: "Vital signs",
    description: "Measurements are encrypted and stay pending until a doctor reviews them. They are not anchored on Sepolia from this screen.",
  },
  visit_note: {
    title: "Visit note",
    description: "Record check-in, the reason for the visit, symptoms, and nursing observations. A doctor reviews the note before it becomes part of the clinical record.",
  },
  laboratory: {
    title: "Laboratory intake",
    description: "Enter the structured report for doctor review. The status stays Pending doctor review until the doctor approves or rejects it. Files are not uploaded.",
  },
};

function emptyFields(kind) {
  if (kind === "vital") return { notes: "" };
  if (kind === "visit_note") return { checkInAt: "", reason: "", symptoms: "", observations: "" };
  return { testName: "", result: "", unit: "", referenceRange: "", collectedOn: "", notes: "" };
}

export function NursingIntakeScreen({ pageKey, kind }) {
  const { page, crumbs } = pageChrome(pageKey);
  const copy = COPY[kind];
  const [patientId, setPatientId] = useState("");
  const [recordedOn, setRecordedOn] = useState("");
  const [fields, setFields] = useState(() => emptyFields(kind));
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  function setField(name, value) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function load(id) {
    setLoading(true);
    setNotice("");
    try {
      const result = await nursingService.list(id);
      setItems((result.items || []).filter((item) => item.kind === kind));
    } catch (error) {
      setItems([]);
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The hospital service could not complete the request.");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (lock.current) return;
    const id = patientId.trim().toUpperCase();
    const issue = !/^PATIENT-[0-9]{1,12}$/.test(id)
      ? "Enter the lifetime patient ID."
      : nursingIssues(kind, fields, recordedOn);
    if (issue) {
      setNotice(issue);
      return;
    }
    lock.current = true;
    setSaving(true);
    setNotice("");
    try {
      const saved = await nursingService.create(id, nursingBody(kind, recordedOn, fields));
      setFields(emptyFields(kind));
      setNotice(`${copy.title} saved. Status: ${saved.label || "Pending doctor review"}.`);
      await load(id);
    } catch (error) {
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The hospital service could not complete the request.");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      <form onSubmit={onSubmit} noValidate>
        <Card title={copy.title} description={copy.description}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Patient ID" name="patientId" value={patientId} onChange={(event) => setPatientId(event.target.value)} placeholder="PATIENT-000001" />
            <Input label="Recorded on" name="recordedOn" type="date" value={recordedOn} onChange={(event) => setRecordedOn(event.target.value)} />
            {kind === "vital" ? vitalFields().map(([name, label, unit, example]) => (
              <Input
                key={name}
                label={`${label} (${unit})`}
                name={name}
                value={fields[name] || ""}
                placeholder={example}
                onChange={(event) => setField(name, event.target.value)}
              />
            )) : null}
            {kind === "vital" ? (
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-sm font-medium text-ink">Notes (optional)</span>
                <textarea className="min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" value={fields.notes || ""} onChange={(event) => setField("notes", event.target.value)} />
              </label>
            ) : null}
            {kind === "visit_note" ? (
              <>
                <Input label="Check-in time" name="checkInAt" type="datetime-local" value={fields.checkInAt || ""} onChange={(event) => setField("checkInAt", event.target.value)} />
                <Input label="Visit reason" name="reason" value={fields.reason || ""} onChange={(event) => setField("reason", event.target.value)} placeholder="Scheduled check-in" />
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Symptoms</span>
                  <textarea className="min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" value={fields.symptoms || ""} onChange={(event) => setField("symptoms", event.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Nursing observations</span>
                  <textarea className="min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" value={fields.observations || ""} onChange={(event) => setField("observations", event.target.value)} />
                </label>
              </>
            ) : null}
            {kind === "laboratory" ? (
              <>
                <Input label="Test" name="testName" value={fields.testName || ""} onChange={(event) => setField("testName", event.target.value)} placeholder="Hemoglobin" />
                <Input label="Result" name="result" value={fields.result || ""} onChange={(event) => setField("result", event.target.value)} placeholder="13.2" />
                <Input label="Unit (optional)" name="unit" value={fields.unit || ""} onChange={(event) => setField("unit", event.target.value)} placeholder="g/dL" />
                <Input label="Reference range (optional)" name="referenceRange" value={fields.referenceRange || ""} onChange={(event) => setField("referenceRange", event.target.value)} />
                <Input label="Collected on (optional)" name="collectedOn" type="date" value={fields.collectedOn || ""} onChange={(event) => setField("collectedOn", event.target.value)} />
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Notes for the doctor (optional)</span>
                  <textarea className="min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" value={fields.notes || ""} onChange={(event) => setField("notes", event.target.value)} />
                </label>
              </>
            ) : null}
          </div>
          {notice ? <p role="status" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" variant="secondary" loading={loading} disabled={loading || saving} onClick={() => load(patientId.trim().toUpperCase())}>Load this patient</Button>
            <Button type="submit" loading={saving} disabled={loading || saving}>Save for doctor review</Button>
          </div>
        </Card>
      </form>
      <Card className="mt-4" title="Submissions for this patient">
        {items.length === 0 ? (
          <EmptyState title="No submissions loaded" description="Save an entry or load the patient ID. Pending items are not visible to the patient until a doctor reviews them." />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border border-line px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={item.status === "reviewed" ? "success" : item.status === "rejected" ? "danger" : "warning"}>{item.label}</StatusBadge>
                  <span className="text-xs text-muted">{item.createdAt ? new Date(item.createdAt).toLocaleString() : "Time unavailable"} · {item.authorName || "Hospital staff"}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-ink">{describe(item)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function describe(item) {
  const content = item.content || {};
  if (item.kind === "vital") {
    return ["bloodPressure", "heartRate", "temperature", "spo2", "respiratoryRate", "height", "weight"]
      .filter((name) => content[name])
      .map((name) => `${content[name]} ${content[`${name}Unit`] || ""}`.trim())
      .join(" · ") || "Measurement stored.";
  }
  if (item.kind === "visit_note") return [content.reason, content.symptoms, content.observations].filter(Boolean).join(" · ");
  return [content.testName, content.result, content.unit].filter(Boolean).join(" · ");
}
