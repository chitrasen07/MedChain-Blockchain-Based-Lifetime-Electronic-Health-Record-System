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
import { patientService } from "../services/patientService";

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function PatientLookupScreen({ pageKey, chart = false }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [params] = useSearchParams();
  const scannedId = (params.get("patientId") || "").trim().toUpperCase();
  const [patientId, setPatientId] = useState(scannedId);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(chart && /^PATIENT-[0-9]{1,12}$/.test(scannedId));
  const [patient, setPatient] = useState(null);
  const [record, setRecord] = useState(null);
  const [walletAddress, setWalletAddress] = useState("");

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  useEffect(() => {
    const id = (params.get("patientId") || "").trim().toUpperCase();
    if (!chart || !/^PATIENT-[0-9]{1,12}$/.test(id)) return undefined;
    let active = true;
    patientService.get(id).then(async (found) => {
      if (!active) return;
      setPatientId(id);
      setPatient(found);
      try {
        setRecord(await apiClient.request(`/patients/${encodeURIComponent(id)}/chart`));
      } catch (requestError) {
        setRecord(null);
        setNotice(requestError instanceof ApiError ? messageForRequest(requestError) : "The chart could not be opened.");
      }
    }).catch((requestError) => {
      if (!active) return;
      setPatient(null);
      setRecord(null);
      setNotice(requestError instanceof ApiError && requestError.status === 404
        ? "No confirmed patient with that ID was found in this hospital."
        : "The hospital service could not complete the request.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [chart, params]); // Prefills a scanned patient ID. The chart request still requires authorization.

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
      {record ? <PatientChart chart={record} patientId={patient.patientId} onReload={() => loadChart(patient.patientId)} /> : null}
    </div>
  );
}
