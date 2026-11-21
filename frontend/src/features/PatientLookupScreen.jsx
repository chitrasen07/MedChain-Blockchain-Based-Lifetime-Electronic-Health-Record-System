import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { PatientChart } from "./PatientChart";
import { ApiError, apiClient, messageForRequest } from "../lib/api";
import { pageChrome } from "../lib/pageChrome";
import { connectPatientWallet, signPatientLogin } from "../lib/patientWallet";
import { clinicalService } from "../services/clinicalService";
import { nursingService } from "../services/nursingService";
import { patientService } from "../services/patientService";

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function PatientLookupScreen({ pageKey, chart = false, intake = false }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [params] = useSearchParams();
  const scannedId = (params.get("patientId") || "").trim().toUpperCase();
  const [patientId, setPatientId] = useState(scannedId);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState((chart || intake) && /^PATIENT-[0-9]{1,12}$/.test(scannedId));
  const [patient, setPatient] = useState(null);
  const [record, setRecord] = useState(null);
  const [summary, setSummary] = useState(null);
  const [walletAddress, setWalletAddress] = useState("");

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  useEffect(() => {
    const id = (params.get("patientId") || "").trim().toUpperCase();
    if ((!chart && !intake) || !/^PATIENT-[0-9]{1,12}$/.test(id)) return undefined;
    let active = true;
    patientService.get(id).then(async (found) => {
      if (!active) return;
      setPatientId(id);
      setPatient(found);
      try {
        if (intake) setSummary(await nursingService.summary(id));
        if (chart) setRecord(await apiClient.request(`/patients/${encodeURIComponent(id)}/chart`));
      } catch (requestError) {
        if (chart) setRecord(null);
        if (intake) setSummary(null);
        setNotice(requestError instanceof ApiError ? messageForRequest(requestError) : "The chart could not be opened.");
      }
    }).catch((requestError) => {
      if (!active) return;
      setPatient(null);
      setRecord(null);
      setSummary(null);
      setNotice(requestError instanceof ApiError && requestError.status === 404
        ? "No confirmed patient with that ID was found in this hospital."
        : "The hospital service could not complete the request.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [chart, intake, params]); // Prefills a scanned patient ID. The chart request still requires authorization.

  async function connectWallet() {
    setNotice("");
    try {
      const address = await connectPatientWallet();
      await clinicalService.bindWallet(address, signPatientLogin);
      setWalletAddress(address);
      setNotice("Clinical wallet connected. The chart still requires patient consent or an active emergency grant.");
    } catch (requestError) {
      setWalletAddress("");
      setNotice(requestError instanceof ApiError ? messageForRequest(requestError) : "The wallet was not connected.");
    }
  }

  async function loadChart(id) {
    if (intake) {
      try { setSummary(await nursingService.summary(id)); } catch (requestError) {
        setSummary(null);
        setNotice(requestError instanceof ApiError ? messageForRequest(requestError) : "The patient summary could not be opened.");
      }
    }
    if (!chart) {
      setRecord(null);
      return;
    }
    try {
      setRecord(await apiClient.request(`/patients/${encodeURIComponent(id)}/chart`));
    } catch (requestError) {
      setRecord(null);
      setNotice(requestError instanceof ApiError ? messageForRequest(requestError) : "The chart could not be opened.");
    }
  }

  async function onSubmit(event) {
    event?.preventDefault?.();
    const id = patientId.trim().toUpperCase();
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
      await loadChart(id);
    } catch (requestError) {
      setPatient(null);
      setRecord(null);
      setSummary(null);
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
          {chart ? <Button className="mt-4 mr-3" type="button" variant="secondary" onClick={connectWallet}>Connect clinical wallet</Button> : null}
          <Button className="mt-4" type="submit" loading={loading} disabled={loading}>Look up</Button>
          {walletAddress ? <p className="mt-3 text-sm text-muted">{walletAddress}</p> : null}
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
      {summary ? <StaffSummary summary={summary} /> : null}
      {record ? <PatientChart chart={record} patientId={patient.patientId} onReload={() => loadChart(patient.patientId)} /> : null}
    </div>
  );
}

function StaffSummary({ summary }) {
  const demographics = summary.demographics || {};
  return (
    <Card className="mt-4" title="Permitted details" description="Name and date of birth come from the hospital registration. Visit notes, vitals, and laboratory intake are the nursing submissions for this hospital. Doctor diagnoses are not included.">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Name</dt><dd className="mt-1 text-ink">{demographics.fullName || "Not recorded"}</dd></div>
        <div><dt className="text-muted">Date of birth</dt><dd className="mt-1 text-ink">{demographics.dateOfBirth || "Not recorded"}</dd></div>
        <div><dt className="text-muted">Gender</dt><dd className="mt-1 text-ink">{demographics.gender || "Not recorded"}</dd></div>
        <div><dt className="text-muted">Blood group</dt><dd className="mt-1 text-ink">{demographics.bloodGroup || "Not recorded"}</dd></div>
      </dl>
      <IntakeList title="Visit notes" items={summary.visits} />
      <IntakeList title="Vital signs" items={summary.vitals} />
      <IntakeList title="Laboratory reports" items={summary.labs} />
    </Card>
  );
}

function IntakeList({ title, items }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-navy">{title}</h3>
      {items?.length ? items.map((item) => (
        <p key={item.id} className="mt-2 text-sm text-ink">
          <span className="font-medium">{item.label}</span>
          <span className="mt-1 block text-ink">{line(item)}</span>
        </p>
      )) : <p className="mt-1 text-sm text-muted">None recorded.</p>}
    </div>
  );
}

function line(item) {
  const content = item.content || {};
  if (item.kind === "visit_note") return [content.checkInAt, content.reason, content.symptoms, content.observations].filter(Boolean).join(" · ");
  if (item.kind === "laboratory") return [content.testName, content.result, content.unit].filter(Boolean).join(" · ");
  return ["bloodPressure", "heartRate", "temperature", "spo2", "respiratoryRate", "height", "weight"].filter((name) => content[name]).map((name) => content[name]).join(" · ") || "Measurement stored.";
}
