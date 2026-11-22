import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Input } from "../components/Input";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, apiClient, messageForRequest } from "../lib/api";
import { anchorLabel, anchorTone, emergencyCardUrl, exactAllergyAlert, filterTimeline, listText } from "../lib/chartView";
import { clinicalService } from "../services/clinicalService";
import { DemographicCorrectionForm } from "./DemographicCorrectionForm";

const TABS = ["Overview", "Medical History", "Vitals", "Prescriptions", "Lab Reports", "Visits", "Consent", "Blockchain", "Audit"];

function Fact({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value || "Not recorded"}</dd>
    </div>
  );
}

function Sparkline({ points }) {
  const numeric = points.filter((point) => typeof point.chart?.value === "number");
  if (numeric.length < 2) return null;
  const values = numeric.map((point) => point.chart.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coordinates = numeric.map((point, index) => {
    const x = (index / (numeric.length - 1)) * 280;
    const y = 72 - ((point.chart.value - min) / span) * 64;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 280 80" className="mt-3 h-20 w-full text-teal" role="img" aria-label="Recorded measurements">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={coordinates} />
    </svg>
  );
}

function Verification({ record }) {
  const label = anchorLabel(record);
  return (
    <div className="mt-2 space-y-1 text-xs text-muted">
      <p>Version {record.version ?? record.versionIndex ?? 0} · {record.storage || "Encrypted"} · {record.reportStatus || label}</p>
      {record.author ? <p>{record.author}{record.createdAt ? ` · ${new Date(record.createdAt).toLocaleString()}` : ""}</p> : null}
      {record.correctionReason ? <p>Correction: {record.correctionReason}</p> : null}
      <p className="break-all">{record.contentHash || "Not recorded"}</p>
      {record.etherscanUrl ? (
        <a className="break-all text-teal" href={record.etherscanUrl} target="_blank" rel="noreferrer">{record.transaction}</a>
      ) : (
        <p>{record.transaction ? `Transaction ${record.transaction}` : "No confirmed Sepolia transaction."}</p>
      )}
    </div>
  );
}

function EmergencyQr({ patientId }) {
  const [svg, setSvg] = useState("");
  const url = emergencyCardUrl(window.location.origin, patientId);
  useEffect(() => {
    let active = true;
    if (!url) return undefined;
    QRCode.toString(url, { type: "svg", margin: 1, width: 180 }).then((image) => {
      if (active) setSvg(image);
    }).catch(() => {
      if (active) setSvg("");
    });
    return () => {
      active = false;
    };
  }, [url]);
  return (
    <Card title="Emergency card" description="The code contains the lifetime patient ID only. Scanning opens staff sign-in and does not reveal the chart.">
      {svg ? <div className="max-w-[180px]" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="text-sm text-muted">{url}</p>}
      <p className="mt-3 break-all text-xs text-muted">{url}</p>
    </Card>
  );
}

export function PatientChart({ chart, patientId, readOnly = false, onReload }) {
  const [tab, setTab] = useState("Overview");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const summary = chart.summary || {};
  const timeline = filterTimeline(chart.timeline, { query, category, from, to });
  const allergies = summary.allergyDetails || [];

  async function downloadPdf() {
    setNotice("");
    try {
      const path = readOnly ? "/patient-portal/chart.pdf" : `/patients/${encodeURIComponent(patientId)}/chart.pdf`;
      const blob = await apiClient.download(path);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "medchain-summary.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The summary could not be downloaded.");
    }
  }

  async function saveRecord(body) {
    setSaving(true);
    setNotice("");
    try {
      const saved = await clinicalService.create(patientId, body);
      if (saved.alerts?.length) {
        setNotice(saved.alerts.map((item) => item.message).join(" "));
      }
      await onReload?.();
    } catch (error) {
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The entry was not saved.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDetails(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await saveProfile(data);
  }

  async function saveProfile(data) {
    setSaving(true);
    setNotice("");
    try {
      await apiClient.request(`/patients/${encodeURIComponent(patientId)}/profile-details`, {
        method: "POST",
        body: { gender: String(data.get("gender") || ""), bloodGroup: String(data.get("bloodGroup") || "") },
      });
      await onReload?.();
    } catch (error) {
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The details were not saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((item) => (
            <button key={item} type="button" className={`rounded-full px-3 py-1 text-sm ${tab === item ? "bg-navy text-white" : "bg-canvas text-ink"}`} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </div>
        <Button type="button" variant="secondary" onClick={downloadPdf}>Download summary</Button>
      </div>
      {notice ? <p role="alert" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
      {tab === "Overview" ? (
        <div className="space-y-4">
          {!readOnly ? <Card title="Demographic correction" description="Authorized corrections are versioned and encrypted. The lifetime Patient ID stays the same."><DemographicCorrectionForm patientId={patientId} /></Card> : null}
          {chart.demographicCorrections?.length ? (
            <Card title="Correction history" description="The reason is stored with the version. The original registration is not overwritten.">
              {chart.demographicCorrections.map((item, index) => (
                <p key={`${item.createdAt}-${index}`} className="mb-2 text-sm text-ink">Corrected version · {item.author} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : "Time unavailable"} · {item.reason}</p>
              ))}
            </Card>
          ) : null}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <Card title="Health summary">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label="Full name" value={summary.fullName} />
              <Fact label="Age" value={Number.isInteger(summary.age) ? String(summary.age) : "Not recorded"} />
              <Fact label="Gender" value={summary.gender} />
              <Fact label="Blood group" value={summary.bloodGroup} />
              <Fact label="Lifetime patient ID" value={summary.patientId} />
              <Fact label="DID" value={summary.did} />
              <Fact label="Known allergies" value={listText(summary.allergies)} />
              <Fact label="Chronic conditions" value={listText(summary.chronicConditions)} />
              <Fact label="Current diseases" value={listText(summary.currentDiseases)} />
              <Fact label="Latest diagnosis" value={summary.latestDiagnosis} />
              <Fact label="Current medications" value={listText(summary.currentMedications)} />
              <Fact label="Past diseases" value={listText(summary.pastDiseases)} />
              <Fact label="Surgeries" value={listText(summary.surgeries)} />
              <Fact label="Treatments" value={listText(summary.treatments)} />
              <Fact label="Last hospital visit" value={summary.lastVisit} />
              <Fact label="Latest medical update" value={summary.latestUpdate ? `${summary.latestUpdate.recordedOn}: ${summary.latestUpdate.summary}` : "Not recorded"} />
            </dl>
            {allergies.length ? (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-ink">
                Recorded allergies: {allergies.map((item) => `${item.substance} (${item.reaction})`).join("; ")}.
              </p>
            ) : null}
          </Card>
          <EmergencyQr patientId={patientId} />
          {readOnly ? null : (
            <Card className="lg:col-span-2" title="Recorded demographics" description="Saving gender or blood group adds a new encrypted note. It does not replace the registration record.">
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveDetails}>
                <Input label="Gender" name="gender" />
                <Input label="Blood group" name="bloodGroup" />
                <Button type="submit" loading={saving} disabled={saving}>Save details</Button>
              </form>
            </Card>
          )}
        </div>
        </div>
      ) : null}
      {tab === "Medical History" ? (
        <Card title="Lifetime timeline" description="Each correction remains a separate version.">
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Input label="Search" name="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            <Input label="Category" name="category" value={category} onChange={(event) => setCategory(event.target.value)} />
            <Input label="From" name="from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <Input label="To" name="to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          {timeline.length === 0 ? <EmptyState title="No matching history" description="Recorded visits, diagnoses, prescriptions, labs, allergies, treatments, and corrections appear here." /> : (
            <ol className="space-y-4">
              {timeline.map((item) => (
                <li key={`${item.id}-${item.version}`} className="border-b border-line pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium capitalize text-navy">{item.category}</p>
                    <StatusBadge tone={anchorTone(item.anchorStatus)}>{item.anchorStatus}</StatusBadge>
                    {item.correction ? <StatusBadge tone="info">Correction</StatusBadge> : null}
                  </div>
                  <p className="mt-1 text-sm text-ink">{item.title}</p>
                  <p className="mt-1 text-xs text-muted">{item.at || "Not recorded"} · {item.clinician} · version {item.version}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : null}
      {tab === "Vitals" ? (
        <Card title="Vital signs" description="Only measurements saved by an authorized clinician are shown.">
          {chart.vitals?.length ? chart.vitals.map((series) => (
            <section key={series.key} className="mb-4">
              <h3 className="text-sm font-semibold text-navy">{series.label}</h3>
              <Sparkline points={series.points} />
              <ul className="mt-2 space-y-1 text-sm text-ink">
                {series.points.map((point) => <li key={point.id}>{point.recordedOn}: {point.value} {point.unit}</li>)}
              </ul>
            </section>
          )) : <EmptyState title="No vital signs" description="Blood pressure, heart rate, temperature, SpO2, weight, height, and blood glucose appear after they are recorded." />}
          {readOnly ? null : <RecordForm patientId={patientId} category="vital" saving={saving} onSubmit={saveRecord} />}
        </Card>
      ) : null}
      {tab === "Prescriptions" ? (
        <Card title="Prescriptions" description="A clinician enters each prescription. MedChain does not prescribe medication.">
          <AllergyNotice allergies={allergies} />
          <PrescriptionList title="Active" items={chart.prescriptions?.active || []} />
          <PrescriptionList title="Historical" items={chart.prescriptions?.historical || []} />
          {readOnly ? null : <RecordForm patientId={patientId} category="prescription" saving={saving} allergies={allergies} onSubmit={saveRecord} />}
        </Card>
      ) : null}
      {tab === "Lab Reports" ? (
        <Card title="Laboratory results" description="A result is not marked normal or abnormal. A stored reference range is shown as text.">
          {chart.labs?.results?.length ? chart.labs.results.map((result) => (
            <article key={result.id} className="mb-4 border-b border-line pb-3">
              <p className="text-sm font-medium text-navy">{result.testName}</p>
              <p className="mt-1 text-sm text-ink">{result.result} {result.unit !== "Not recorded" ? result.unit : ""}</p>
              <p className="mt-1 text-xs text-muted">Collected {result.collectedOn} · Result {result.resultDate} · Range {result.referenceRange} · {result.author}</p>
              <p className="mt-1 text-sm text-ink">{result.notes}</p>
            </article>
          )) : <EmptyState title="No laboratory results" description="Structured results appear after a clinician records them." />}
          {(chart.labs?.trends || []).map((trend) => (
            <p key={`${trend.testName}-${trend.unit}`} className="text-sm text-ink">{trend.testName} ({trend.unit || "unit not recorded"}): {trend.points.map((point) => `${point.recordedOn} ${point.result}`).join(", ")}</p>
          ))}
          {readOnly ? null : <RecordForm patientId={patientId} category="laboratory" saving={saving} onSubmit={saveRecord} />}
        </Card>
      ) : null}
      {tab === "Visits" ? (
        <Card title="Visits">
          {chart.visits?.length ? chart.visits.map((visit) => (
            <article key={visit.id} className="mb-3">
              <p className="text-sm font-medium text-navy">{visit.recordedOn}</p>
              <p className="text-sm text-ink">{visit.reason}</p>
              <p className="text-xs text-muted">{visit.notes} · {visit.author}</p>
            </article>
          )) : <EmptyState title="No visits" description="Hospital visits recorded for this patient appear here." />}
        </Card>
      ) : null}
      {tab === "Consent" ? (
        <Card title="Consent history" description="Only the patient controller wallet can grant or revoke consent in MetaMask.">
          {chart.consent?.length ? chart.consent.map((item) => (
            <article key={item.wallet} className="mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-navy">{item.doctorName}</p>
                <StatusBadge tone={item.active ? "success" : "warning"}>{item.status}</StatusBadge>
              </div>
              <p className="mt-1 break-all text-xs text-muted">{item.wallet}</p>
              <p className="mt-1 text-xs text-muted">{item.expiresAt ? `Expires ${new Date(item.expiresAt * 1000).toLocaleString()}` : "No expiry recorded"}</p>
              {(item.events || []).map((event) => (
                <p key={`${event.action}-${event.transaction}`} className="mt-1 text-xs text-muted">
                  {event.action} {event.etherscanUrl ? <a className="text-teal" href={event.etherscanUrl} target="_blank" rel="noreferrer">{event.transaction}</a> : "No transaction reference"}
                </p>
              ))}
            </article>
          )) : <EmptyState title="No consent records" description="Grants, revocations, and expirations from Sepolia appear here. The hospital wallet cannot grant access." />}
        </Card>
      ) : null}
      {tab === "Blockchain" ? (
        <Card title="Record verification" description="The hash is anchored on the existing MedicalRecordRegistry. The clinical text stays encrypted off-chain.">
          {chart.blockchain?.length ? chart.blockchain.map((record) => (
            <article key={record.id} className="mb-4 border-b border-line pb-3">
              <p className="text-sm font-medium capitalize text-navy">{record.category} · {record.recordedOn}</p>
              <Verification record={record} />
            </article>
          )) : <EmptyState title="No records to verify" description="Encrypted records and their Sepolia anchor status appear here." />}
          <h3 className="mt-4 text-sm font-semibold text-navy">Version history</h3>
          {chart.versions?.length ? chart.versions.map((group) => (
            <div key={group.recordRef} className="mt-3">
              <p className="text-sm capitalize text-ink">{group.category}</p>
              {group.versions.map((version) => (
                <p key={version.id} className="text-xs text-muted">Version {version.version} · {version.recordedOn} · {version.author}{version.createdAt ? ` · ${new Date(version.createdAt).toLocaleString()}` : ""} · {version.reportStatus || version.anchorStatus} · {version.storage}{version.correctionReason ? ` · Correction: ${version.correctionReason}` : ""}</p>
              ))}
            </div>
          )) : null}
        </Card>
      ) : null}
      {tab === "Audit" ? (
        <Card title="Audit trail" description="Events name the action only. Clinical text and secrets are not written here.">
          {readOnly ? <Link className="mb-3 inline-flex text-sm font-medium text-teal hover:text-teal-dark" to="/patient/activity">Open My Activity & Access History</Link> : null}
          {chart.audit?.length ? chart.audit.map((event, index) => (
            <p key={`${event.action}-${event.at}-${index}`} className="mb-2 text-sm text-ink">
              <span className="font-medium text-navy">{event.action}</span>
              <span className="mt-1 block text-xs text-muted">{event.at || "Time unavailable"} · {event.actor} · {event.source}{event.category ? ` · ${event.category}` : ""}{Number.isInteger(event.version) ? ` · version ${event.version}` : ""}</span>
            </p>
          )) : <EmptyState title="No audit events" description="Created, viewed, corrected, consent, anchor, and emergency events appear here." />}
        </Card>
      ) : null}
    </div>
  );
}

function AllergyNotice({ allergies }) {
  if (!allergies?.length) return <p className="mb-3 text-sm text-muted">No allergies are recorded.</p>;
  return <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-ink">Recorded allergies: {allergies.map((item) => item.substance).join(", ")}.</p>;
}

function PrescriptionList({ title, items }) {
  if (!items.length) return <p className="mb-3 text-sm text-muted">No {title.toLowerCase()} prescriptions.</p>;
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-navy">{title}</h3>
      {items.map((item) => (
        <article key={item.id} className="mt-2">
          <p className="text-sm text-ink">{item.medication} · {item.dosage} · {item.frequency} · {item.route} · {item.duration}</p>
          <p className="text-xs text-muted">{item.startDate} to {item.endDate} · {item.instructions} · {item.author}</p>
          {item.alerts?.length ? <p className="text-sm text-danger">{item.alerts[0].message}</p> : null}
        </article>
      ))}
    </div>
  );
}

function RecordForm({ category, saving, allergies = [], onSubmit }) {
  const [fields, setFields] = useState({});
  const [recordedOn, setRecordedOn] = useState("");
  const spec = {
    vital: [["bloodPressure", "Blood pressure"], ["heartRate", "Heart rate"], ["temperature", "Temperature"], ["spo2", "SpO2"], ["weight", "Weight"], ["height", "Height"], ["bloodGlucose", "Blood glucose"]],
    prescription: [["medication", "Medication"], ["dose", "Dosage"], ["frequency", "Frequency"], ["route", "Route"], ["duration", "Duration"], ["instructions", "Instructions"], ["startDate", "Start date"], ["endDate", "End date"]],
    laboratory: [["testName", "Test"], ["result", "Result"], ["unit", "Unit"], ["referenceRange", "Reference range"], ["collectedOn", "Collection date"], ["resultDate", "Result date"], ["notes", "Notes"]],
  }[category];
  const matches = category === "prescription" ? exactAllergyAlert(allergies, fields.medication) : [];
  return (
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      const bodyFields = {};
      for (const [name] of spec) if (fields[name]?.trim()) bodyFields[name] = fields[name].trim();
      onSubmit({ category, recordedOn, fields: bodyFields });
    }}>
      <Input label="Recorded on" name="recordedOn" type="date" value={recordedOn} onChange={(event) => setRecordedOn(event.target.value)} />
      {spec.map(([name, label]) => (
        <Input key={name} label={label} name={name} value={fields[name] || ""} onChange={(event) => setFields((current) => ({ ...current, [name]: event.target.value }))} />
      ))}
      {matches.length ? <p className="sm:col-span-2 text-sm text-danger">Recorded allergy matches this medication exactly: {matches[0].substance}. This is not a drug-interaction check.</p> : null}
      <Button type="submit" loading={saving} disabled={saving}>Save encrypted entry</Button>
    </form>
  );
}
