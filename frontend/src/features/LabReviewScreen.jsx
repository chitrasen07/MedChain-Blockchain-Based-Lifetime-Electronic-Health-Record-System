import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, messageForRequest } from "../lib/api";
import { pageChrome } from "../lib/pageChrome";
import { connectPatientWallet, signPatientLogin } from "../lib/patientWallet";
import { clinicalService } from "../services/clinicalService";
import { nursingService } from "../services/nursingService";

export function LabReviewScreen({ pageKey }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [patientId, setPatientId] = useState("");
  const [items, setItems] = useState([]);
  const [queue, setQueue] = useState({ pendingLabs: [], visitTasks: [], pendingVitals: [] });
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const lock = useRef(false);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
    let active = true;
    nursingService.queue().then((result) => {
      if (active) setQueue(result);
    }).catch(() => {
      if (active) setQueue({ pendingLabs: [], visitTasks: [], pendingVitals: [] });
    });
    return () => {
      active = false;
    };
  }, [page.title]);

  async function connectWallet() {
    setNotice("");
    try {
      const address = await connectPatientWallet();
      await clinicalService.bindWallet(address, signPatientLogin);
      setWalletAddress(address);
      setNotice("Clinical wallet connected. Review still requires this patient's consent.");
    } catch (error) {
      setWalletAddress("");
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The wallet was not connected. No transaction was sent.");
    }
  }

  async function load(id) {
    const patient = (id || patientId).trim().toUpperCase();
    if (!/^PATIENT-[0-9]{1,12}$/.test(patient)) {
      setNotice("Enter the lifetime patient ID.");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const result = await nursingService.list(patient);
      setItems(result.items || []);
      setPatientId(patient);
    } catch (error) {
      setItems([]);
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The hospital service could not complete the request.");
    } finally {
      setLoading(false);
    }
  }

  async function review(item, decision) {
    if (lock.current) return;
    lock.current = true;
    setSavingId(item.id);
    setNotice("");
    try {
      const saved = await nursingService.review(item.id, {
        decision,
        ...(decision === "reject" && note.trim() ? { note: note.trim() } : {}),
      });
      setNotice(decision === "approve"
        ? "The report was approved and saved as a reviewed clinical record. It is not anchored until you sign that step in MetaMask."
        : `The report was marked ${saved.label}.`);
      setNote("");
      await load(item.patientId || patientId);
      const nextQueue = await nursingService.queue();
      setQueue(nextQueue);
    } catch (error) {
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The review was not saved.");
    } finally {
      lock.current = false;
      setSavingId("");
    }
  }

  const pending = items.filter((item) => item.status === "pending_review");

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      <Card title="Waiting for review" description="This list shows the patient ID and status only. Open a patient after connecting the consented clinical wallet to read the report.">
        <Waiting title="Laboratory reports" items={queue.pendingLabs} onOpen={load} empty="No laboratory reports are waiting." />
        <Waiting title="Visit notes" items={queue.visitTasks} onOpen={load} empty="No visit notes are waiting." />
        <Waiting title="Vital signs" items={queue.pendingVitals} onOpen={load} empty="No vital signs are waiting." />
      </Card>
      <form className="mt-4" onSubmit={(event) => { event.preventDefault(); load(); }} noValidate>
        <Card title="Review a patient" description="Approval copies the encrypted intake into the clinical record. Rejection leaves it out of the chart. Neither action sends a Sepolia transaction.">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={connectWallet}>Connect clinical wallet</Button>
            <p className="text-sm text-muted">{walletAddress || "No clinical wallet connected."}</p>
          </div>
          <Input label="Patient ID" name="patientId" value={patientId} onChange={(event) => setPatientId(event.target.value)} placeholder="PATIENT-000001" />
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Rejection note (optional)</span>
            <textarea className="min-h-20 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {notice ? <p role="status" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
          <Button className="mt-4" type="submit" loading={loading} disabled={loading || Boolean(savingId)}>Load intake</Button>
        </Card>
      </form>
      <Card className="mt-4" title="Intake for this patient">
        {pending.length === 0 ? <EmptyState title="No pending intake" description="Load a patient who has nursing vitals, visit notes, or laboratory reports waiting for review." /> : (
          <ul className="space-y-4">
            {pending.map((item) => (
              <li key={item.id} className="rounded-lg border border-line px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium capitalize text-navy">{item.kind.replace("_", " ")}</p>
                  <StatusBadge tone="warning">{item.label}</StatusBadge>
                </div>
                <p className="mt-2 text-sm leading-6 text-ink">{Object.entries(item.content || {}).filter(([key]) => !["kind", "recordedOn"].includes(key) && !key.endsWith("Unit")).map(([, value]) => value).join(" · ")}</p>
                <p className="mt-1 text-xs text-muted">{item.authorName || "Hospital staff"} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : "Time unavailable"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" loading={savingId === item.id} disabled={!walletAddress || Boolean(savingId)} onClick={() => review(item, "approve")}>Approve</Button>
                  <Button type="button" variant="secondary" loading={savingId === item.id} disabled={!walletAddress || Boolean(savingId)} onClick={() => review(item, "reject")}>Reject</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Waiting({ title, items, onOpen, empty }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-navy">{title}</h3>
      {items?.length ? (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-navy">{item.patientId}</span>
              <span className="flex items-center gap-2">
                <StatusBadge tone="warning">{item.label}</StatusBadge>
                <Button type="button" variant="secondary" onClick={() => onOpen(item.patientId)}>Open</Button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm text-muted">{empty}</p>}
    </div>
  );
}
