import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { VerificationNotice } from "../components/VerificationNotice";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, messageForRequest } from "../lib/api";
import { SEPOLIA_CHAIN_ID, waitForReceipt } from "../lib/claimChain";
import { anchorCalldata, previewAnchorTransaction, sendPreparedTransaction, transactionTarget } from "../lib/consentChain";
import { ensurePatientSepolia } from "../lib/patientWallet";
import { sepoliaTransactionUrl } from "../lib/ownership";
import { pageChrome } from "../lib/pageChrome";
import { connectPatientWallet, signPatientLogin } from "../lib/patientWallet";
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
  const [walletAddress, setWalletAddress] = useState("");
  const [chainId, setChainId] = useState(null);
  const [sendingAnchor, setSendingAnchor] = useState(false);
  const anchorLock = useRef(false);

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

  async function useSepolia() {
    setNotice("");
    try {
      await globalThis.window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
      setChainId(SEPOLIA_CHAIN_ID);
      setNotice("The wallet is on Sepolia. No record transaction has been sent.");
    } catch (error) {
      setNotice(error?.code === 4001 ? "MetaMask did not approve the network change." : error?.message || "The wallet was not switched.");
    }
  }

  async function connectWallet() {
    setNotice("");
    try {
      const address = await connectPatientWallet();
      await clinicalService.bindWallet(address, signPatientLogin);
      setWalletAddress(address);
      setNotice("Clinical wallet connected. Chart access still requires patient consent or an active emergency grant.");
    } catch (error) {
      setWalletAddress("");
      setNotice(error instanceof ApiError ? messageForRequest(error) : error?.message || "The wallet was not connected. No transaction was sent.");
    }
  }

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

  function anchorLabel(record) {
    if (record.chainStatus === "anchored") return "Anchored";
    if (record.transaction) return "Pending";
    return "Not anchored";
  }

  async function anchorRecord(record) {
    if (anchorLock.current) return;
    const id = patientId.trim().toUpperCase();
    if (record.chainStatus === "anchored") {
      setNotice("This version is already anchored. No transaction was sent.");
      return;
    }
    anchorLock.current = true;
    setSendingAnchor(true);
    setNotice("Checking the doctor, consent, and record before MetaMask opens.");
    try {
      const ethereum = globalThis.window?.ethereum;
      if (record.transaction) {
        const saved = await clinicalService.recordAnchor(id, record.id, record.transaction);
        await load(id);
        if (saved.chainStatus === "anchored") {
          setNotice("The record hash is anchored.");
          return;
        }
        if (saved.chainStatus === "pending") {
          setNotice("An anchor transaction is already pending for this version. No new transaction was sent.");
          return;
        }
      }
      await ensurePatientSepolia();
      const nextChain = Number(await ethereum.request({ method: "eth_chainId" }));
      setChainId(nextChain);
      const target = transactionTarget("anchor", nextChain, import.meta.env?.VITE_LOCAL_MEDICAL_RECORD_REGISTRY);
      if (!target) throw Object.assign(new Error("Switch the wallet to Sepolia before anchoring. No transaction was sent."), { code: "wrong_network" });
      const prepared = await clinicalService.prepareAnchor(id, record.id);
      const local = anchorCalldata({
        versionIndex: record.versionIndex,
        recordRef: record.recordRef,
        patientRef: prepared.patientRef,
        contentHash: record.contentHash,
      });
      if (!local || local !== prepared.data || prepared.contentHash !== record.contentHash) {
        throw new Error("The prepared transaction did not match this record. No transaction was sent.");
      }
      await previewAnchorTransaction({
        chainId: nextChain,
        contractAddress: target,
        data: local,
        from: walletAddress,
        ethereum,
      });
      setNotice("Approve the anchor in MetaMask. It is not signed automatically.");
      const hash = await sendPreparedTransaction({
        chainId: nextChain,
        contractAddress: target,
        data: local,
        ethereum,
        from: walletAddress,
      });
      await clinicalService.recordAnchor(id, record.id, hash);
      setNotice("Transaction submitted. Waiting for Sepolia confirmation.");
      await waitForReceipt(ethereum, hash);
      const saved = await clinicalService.recordAnchor(id, record.id, hash);
      await load(id);
      if (saved.chainStatus === "anchored") {
        setNotice("The record hash is anchored.");
      } else if (saved.chainStatus === "failed") {
        setNotice("The transaction failed on Sepolia. The record was not anchored.");
      } else {
        setNotice("The transaction was submitted. Confirmation is still pending.");
      }
    } catch (error) {
      const rejected = error?.code === 4001 || error?.code === "wallet_rejected";
      setNotice(rejected
        ? "MetaMask did not approve the request. Nothing was sent."
        : error instanceof ApiError
          ? messageForRequest(error)
          : error?.message || "The anchor was not sent.");
    } finally {
      anchorLock.current = false;
      setSendingAnchor(false);
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
      <VerificationNotice>
        Saving a chart stores encrypted data only after the wallet has a clinical role and the patient has granted consent. Anchoring the hash on Sepolia asks MetaMask to approve. The hospital signing key is not used.
      </VerificationNotice>
      <form onSubmit={onSubmit} noValidate>
        <Card
          title="Clinical entry"
          description="The entry is encrypted in the hospital database. Reading or saving it requires the connected wallet to have patient consent or emergency access. The hospital signing key is not used."
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={connectWallet}>Connect clinical wallet</Button>
            <Button type="button" variant="secondary" onClick={useSepolia} disabled={chainId === SEPOLIA_CHAIN_ID}>Use Sepolia</Button>
            <p className="text-sm text-muted">{walletAddress || "No clinical wallet connected."}</p>
          </div>
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
            <Button type="submit" loading={saving} disabled={loading || saving || !walletAddress}>Save encrypted entry</Button>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">
            Anchoring is signed by the consented clinical wallet in MetaMask. A wallet without the Doctor role cannot save or anchor a record. The hospital signing key cannot grant consent or submit the hash.
          </p>
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
                    <StatusBadge tone={record.chainStatus === "anchored" ? "success" : "warning"}>{anchorLabel(record)}</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{record.recordedOn} · version {record.versionIndex}</p>
                  <p className="mt-2 text-sm leading-6 text-ink">{Object.entries(record.content || {}).filter(([key]) => key !== "category" && key !== "recordedOn").map(([, value]) => value).join(" · ")}</p>
                  <p className="mt-1 break-all text-xs text-muted">{record.contentHash}</p>
                  {explorer ? <a className="mt-1 inline-flex break-all text-xs text-teal" href={explorer} target="_blank" rel="noreferrer">{record.transaction}</a> : <p className="mt-1 text-xs text-muted">No transaction reference.</p>}
                  <Button className="mt-2" type="button" variant="secondary" loading={sendingAnchor} disabled={!walletAddress || sendingAnchor || record.chainStatus === "anchored"} onClick={() => anchorRecord(record)}>
                    {record.chainStatus === "anchored" ? "Anchored" : "Anchor this version"}
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
