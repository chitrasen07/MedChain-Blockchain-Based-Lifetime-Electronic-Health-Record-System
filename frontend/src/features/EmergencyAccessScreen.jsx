import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { VerificationNotice } from "../components/VerificationNotice";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { ApiError, messageForRequest } from "../lib/api";
import { consentBroadcastAllowed, emergencyRequestCalldata, reasonHash, sendPreparedTransaction } from "../lib/consentChain";
import { pageChrome } from "../lib/pageChrome";
import { connectPatientWallet, signPatientLogin } from "../lib/patientWallet";
import { clinicalService } from "../services/clinicalService";

const DURATIONS = [
  ["3600", "1 hour"],
  ["14400", "4 hours"],
  ["86400", "24 hours"],
  ["259200", "72 hours"],
];

export function EmergencyAccessScreen({ pageKey }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [patientId, setPatientId] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("14400");
  const [walletAddress, setWalletAddress] = useState("");
  const [chainId, setChainId] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const canSend = consentBroadcastAllowed(chainId) && Boolean(import.meta.env?.VITE_LOCAL_EMERGENCY_ACCESS) && Boolean(prepared);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
    const ethereum = globalThis.window?.ethereum;
    if (!ethereum?.request) return undefined;
    let active = true;
    ethereum.request({ method: "eth_chainId" }).then((value) => {
      if (active) setChainId(Number(value));
    }).catch(() => {
      if (active) setChainId(null);
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
      setNotice("Responder wallet connected. A request is still not sent on a public network.");
    } catch (error) {
      setWalletAddress("");
      setNotice(error instanceof ApiError ? messageForRequest(error) : error?.message || "The wallet was not connected. No transaction was sent.");
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const id = patientId.trim().toUpperCase();
    const text = reason.trim();
    if (!/^PATIENT-[0-9]{1,12}$/.test(id) || text.length < 8 || !walletAddress) {
      setNotice("Enter the patient ID, a reason of at least 8 characters, and connect the responder wallet.");
      return;
    }
    setSaving(true);
    setPrepared(null);
    setNotice("");
    try {
      const result = await clinicalService.prepareEmergency(id, { reason: text, durationSeconds: Number(duration) });
      const local = emergencyRequestCalldata(result.patientRef, text, Number(duration));
      if (!local || local !== result.data || result.reasonHash !== reasonHash(text)) {
        setNotice("The prepared request did not match this reason. Nothing was sent.");
        return;
      }
      setPrepared(result);
      const listed = await clinicalService.listEmergency(id);
      setSessions(listed.sessions || []);
      setNotice(result.message);
    } catch (error) {
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The hospital service could not complete the request.");
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    try {
      await sendPreparedTransaction({
        chainId,
        contractAddress: import.meta.env?.VITE_LOCAL_EMERGENCY_ACCESS,
        data: prepared.data,
        ethereum: globalThis.window?.ethereum,
      });
      setNotice("The emergency request was sent from the responder wallet on the local network.");
    } catch (error) {
      setNotice(error?.message || "The emergency request was not sent.");
    }
  }

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      <VerificationNotice>
        This request is prepared for the responder wallet. Sending it to Sepolia waits for approval. The reason is not written on-chain.
      </VerificationNotice>
      <form onSubmit={onSubmit} noValidate>
        <Card
          title="Emergency request"
          description="The reason is encrypted in the hospital database. The chain receives only its hash, for at most 72 hours, and only from an emergency-responder wallet."
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={connectWallet}>Connect responder wallet</Button>
            <p className="text-sm text-muted">{walletAddress || "No responder wallet connected."}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Patient ID" name="patientId" value={patientId} onChange={(event) => setPatientId(event.target.value)} placeholder="PATIENT-000001" />
            <Select label="Duration" value={duration} onChange={(event) => setDuration(event.target.value)}>
              {DURATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Input className="sm:col-span-2" label="Emergency reason" name="reason" value={reason} onChange={(event) => setReason(event.target.value)} hint="Stored off-chain. It is not written to the transaction." />
          </div>
          {notice ? <p role="status" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="submit" loading={saving} disabled={saving || !walletAddress}>Prepare request</Button>
            <Button type="button" variant="secondary" disabled={!canSend} onClick={send}>Send on local network</Button>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">
            Public networks stay disabled. The hospital signing wallet cannot request emergency access. A new request is refused during the contract cooldown.
          </p>
        </Card>
      </form>
      <Card className="mt-4" title="Known sessions">
        {sessions.length === 0 ? (
          <EmptyState title="No emergency session loaded" description="Prepare a request to read the chain status for this patient. Nothing is invented here." />
        ) : (
          <ul className="space-y-3">
            {sessions.map((session) => (
              <li key={`${session.wallet}-${session.expiresAt}`} className="text-sm leading-6 text-ink">
                <span className="font-medium text-navy">{session.status}</span>
                <span className="mt-1 block break-all text-xs text-muted">{session.wallet}</span>
                {session.reason ? <span className="mt-1 block">{session.reason}</span> : <span className="mt-1 block break-all text-xs text-muted">{session.reasonHash}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
