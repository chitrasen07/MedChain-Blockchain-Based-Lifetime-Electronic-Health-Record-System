import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Select } from "../../components/Select";
import { LoadingSkeleton } from "../../components/LoadingSkeleton";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { UpcomingAppointmentCard } from "../../features/PatientAppointments";
import { VerificationNotice } from "../../components/VerificationNotice";
import { ApiError, apiClient, messageForRequest } from "../../lib/api";
import { claimBroadcastAllowed, sendPatientClaim, waitForReceipt } from "../../lib/claimChain";
import { contractForPatient, grantCalldata, revokeCalldata, sendPreparedTransaction } from "../../lib/consentChain";
import { ensurePatientSepolia } from "../../lib/patientWallet";
import { claimCommitmentForRecoveryCode, sealedClaimForRecoveryCode, sepoliaTransactionUrl } from "../../lib/ownership";
import { useAuth } from "../../context/useAuth";
import { anchorLabel, anchorTone } from "../../lib/chartView";
import { claimStatusBody, clinicianLabel, patientAuthMessage, shortWallet } from "../../services/patientPortal";

function usePortalGet(path) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ phase: "loading", data: null, message: "" });

  useEffect(() => {
    let active = true;
    apiClient.request(path).then(
      (data) => {
        if (active) setState({ phase: "ready", data, message: "" });
      },
      (error) => {
        if (!active) return;
        const message = error instanceof ApiError ? messageForRequest(error) : "The hospital service could not complete the request.";
        setState({ phase: "error", data: null, message });
      },
    );
    return () => {
      active = false;
    };
  }, [path, attempt]);

  return {
    ...state,
    retry() {
      setState({ phase: "loading", data: null, message: "" });
      setAttempt((value) => value + 1);
    },
  };
}

function PortalHeader({ title, description, badge }) {
  useEffect(() => {
    document.title = `${title} · MedChain`;
  }, [title]);

  return (
    <PageHeader
      eyebrow="Patient"
      title={title}
      description={description}
      crumbs={title === "Dashboard" ? [{ label: "Patient" }] : [{ label: "Patient", to: "/patient" }, { label: title }]}
      actions={badge}
    />
  );
}

function IdentitySummary({ identity }) {
  const explorer = sepoliaTransactionUrl(identity.txHash);
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">Lifetime patient ID</dt>
        <dd className="mt-1 text-sm font-semibold text-navy">{identity.patientId}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">Digital health identity</dt>
        <dd className="mt-1 break-all text-sm text-ink">{identity.patientRef}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">Signed-in wallet</dt>
        <dd className="mt-1 break-all text-sm text-ink">{identity.walletAddress}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">On-chain controller</dt>
        <dd className="mt-1 break-all text-sm text-ink">{identity.controller}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">Registration transaction</dt>
        <dd className="mt-1 text-sm text-ink">
          {explorer ? (
            <a className="break-all text-teal hover:text-teal-dark" href={explorer} target="_blank" rel="noreferrer">
              {identity.txHash}
            </a>
          ) : (
            "No confirmed transaction is stored."
          )}
        </dd>
      </div>
    </dl>
  );
}

export function PatientDashboardPage() {
  const state = usePortalGet("/patient-portal/identity");
  return (
    <div>
      <PortalHeader
        title="Dashboard"
        description="Your lifetime ID and the wallet that currently controls the on-chain reference. Clinical charts are not stored here."
        badge={
          state.phase === "ready" ? (
            <StatusBadge tone={state.data.ownership === "controller" ? "success" : "warning"}>
              {state.data.ownership === "controller" ? "Controller verified" : "Unclaimed on chain"}
            </StatusBadge>
          ) : null
        }
      />
      {state.phase === "loading" ? <LoadingSkeleton label="Loading patient identity" /> : null}
      {state.phase === "error" ? <ErrorState title="Identity unavailable" message={state.message} action={<Button onClick={state.retry}>Try again</Button>} /> : null}
      <UpcomingAppointmentCard />
      {state.phase === "ready" ? (
        <div className="space-y-4">
          <Card title="Health identity">
            <IdentitySummary identity={state.data} />
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Visit history">
              <p className="text-sm leading-6 text-muted">Visit references stored for this patient. The chart itself is not included.</p>
              <Link className="mt-3 inline-flex text-sm font-medium text-teal hover:text-teal-dark" to="/patient/history">
                Open visit history
              </Link>
            </Card>
            <Card title="Records and consent">
              <p className="text-sm leading-6 text-muted">
                Medical records are the encrypted entries stored for this patient. Consent and emergency sessions are read from Sepolia. Public transactions are not sent from this portal.
              </p>
              <div className="mt-3 flex flex-wrap gap-4">
                <Link className="text-sm font-medium text-teal hover:text-teal-dark" to="/patient/records">
                  Medical records
                </Link>
                <Link className="text-sm font-medium text-teal hover:text-teal-dark" to="/patient/access">
                  Access permissions
                </Link>
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PatientIdentityPage() {
  const state = usePortalGet("/patient-portal/identity");
  return (
    <div>
      <PortalHeader
        title="Health identity"
        description="The lifetime patient ID, the opaque chain reference, and the controller read from Sepolia."
      />
      {state.phase === "loading" ? <LoadingSkeleton label="Loading health identity" /> : null}
      {state.phase === "error" ? <ErrorState title="Identity unavailable" message={state.message} action={<Button onClick={state.retry}>Try again</Button>} /> : null}
      {state.phase === "ready" ? (
        <Card>
          <IdentitySummary identity={state.data} />
        </Card>
      ) : null}
    </div>
  );
}

export function PatientOwnershipPage() {
  const { user } = useAuth();
  const state = usePortalGet("/patient-portal/identity");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [notice, setNotice] = useState("");
  const [sealedClaim, setSealedClaim] = useState("");
  const [claim, setClaim] = useState(null);
  const [checking, setChecking] = useState(false);
  const [chainId, setChainId] = useState(null);
  const broadcastAllowed = claimBroadcastAllowed(chainId);

  useEffect(() => {
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
  }, []);

  async function handleClaimCheck(event) {
    event.preventDefault();
    setNotice("");
    setSealedClaim("");
    const code = recoveryCode.trim();
    const claimCommitment = claimCommitmentForRecoveryCode(code);
    if (!claimCommitment || !state.data?.patientId) {
      setNotice("Enter the recovery code saved at registration. It stays in this browser.");
      return;
    }
    setChecking(true);
    try {
      const result = await apiClient.request("/patient-auth/claim-status", {
        method: "POST",
        body: claimStatusBody({
          patientId: state.data.patientId,
          walletAddress: user.walletAddress,
          claimCommitment,
          sealedClaim: sealedClaimForRecoveryCode(code, user.walletAddress, state.data.patientRef),
        }),
        authenticated: false,
      });
      if (result?.patientRef) {
        setSealedClaim(sealedClaimForRecoveryCode(code, user.walletAddress, result.patientRef));
      }
      setClaim(result);
      setNotice(result?.message || "The ownership check finished. No transaction was sent.");
    } catch (error) {
      setNotice(patientAuthMessage(error instanceof ApiError ? error : error));
    } finally {
      setChecking(false);
    }
  }

  async function broadcastClaim(kind) {
    const code = recoveryCode.trim();
    const patientRef = state.data?.patientRef;
    const value = kind === "announce" ? sealedClaim : code;
    if (kind === "announce" && claim && claim.canAnnounce === false) {
      setNotice(claim.message || "An announce transaction is already recorded. Do not send another one.");
      return;
    }
    if (kind === "reveal" && claim?.canReveal !== true) {
      setNotice(claim?.message || "Reveal is not available until the contract waiting period ends.");
      return;
    }
    if (kind === "reveal" && !window.confirm("Revealing publishes the recovery code in the transaction. Continue only if you approve it in MetaMask.")) return;
    try {
      const hash = await sendPatientClaim({
        kind,
        patientRef,
        value,
        registryAddress: import.meta.env?.VITE_LOCAL_PATIENT_REGISTRY,
        chainId,
        ethereum: globalThis.window?.ethereum,
      });
      const receipt = await waitForReceipt(globalThis.window?.ethereum, hash, { attempts: 40 });
      if (!receipt) {
        setNotice("Transaction pending. It was submitted. Check again after Sepolia confirms it. Do not send a duplicate.");
        return;
      }
      if (receipt.status === "0x0") {
        setNotice(kind === "announce" ? "The announce transaction reverted. Nothing was claimed." : "The reveal transaction reverted. Sign-in stays unavailable.");
        return;
      }
      setNotice(kind === "announce"
        ? "Announce confirmed. Do not announce again. Reveal stays locked until the contract waiting period ends."
        : "Reveal confirmed. Wallet linked successfully. Sign in again with this wallet.");
      if (kind === "reveal") setRecoveryCode("");
    } catch (error) {
      setNotice(error?.message || "The claim was not sent.");
    }
  }

  return (
    <div>
      <PortalHeader
        title="Ownership"
        description="Confirm the controller wallet or prepare an unclaimed recovery locally. MedChain does not broadcast the claim."
      />
      <VerificationNotice>
        Announce and reveal require MetaMask approval. Reveal is rejected by the contract until its waiting period ends.
      </VerificationNotice>
      {state.phase === "loading" ? <LoadingSkeleton label="Loading ownership" /> : null}
      {state.phase === "error" ? <ErrorState title="Ownership unavailable" message={state.message} action={<Button onClick={state.retry}>Try again</Button>} /> : null}
      {state.phase === "ready" && state.data.ownership === "controller" ? (
        <Card title="Controller wallet">
          <p className="text-sm leading-6 text-muted">
            This wallet is the on-chain controller for {state.data.patientId}. No recovery claim is waiting, and no
            transaction is required.
          </p>
        </Card>
      ) : null}
      {state.phase === "ready" && state.data.ownership === "unclaimed" ? (
        <Card title="Recovery code">
          <p className="text-sm leading-6 text-muted">
            This record has no controller yet. A confirmed announce is kept on Sepolia for one hour before reveal. Do not announce twice, and do not register a new Patient ID.
          </p>
          <form className="mt-4 max-w-lg space-y-4" onSubmit={handleClaimCheck}>
            <Input
              label="Recovery code"
              type="password"
              autoComplete="off"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              hint="Used only to prepare the sealed claim in this browser."
            />
            {notice ? <p role="status" className="text-sm leading-6 text-ink">{notice}</p> : null}
            <Button type="submit" loading={checking} disabled={checking}>
              Check recovery code
            </Button>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" disabled={!broadcastAllowed || !sealedClaim || claim?.canAnnounce === false} onClick={() => broadcastClaim("announce")}>
                Announce claim
              </Button>
              <Button type="button" variant="secondary" disabled={!broadcastAllowed || claim?.canReveal !== true || !recoveryCode.trim()} onClick={() => broadcastClaim("reveal")}>
                Reveal claim
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted">
              The contract rejects a reveal until its waiting period ends. Sepolia and the local network both ask
              MetaMask before sending. A reveal includes the recovery code in public transaction data, never in a hospital request.
            </p>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

function timelineEntries(records, visits) {
  return [
    ...(records || []).map((record) => ({
      id: `record-${record.id}`,
      at: record.recordedOn || "",
      title: record.category,
      detail: Object.entries(record.content || {}).filter(([key]) => key !== "category" && key !== "recordedOn").map(([, value]) => value).join(" · "),
      hash: record.contentHash,
      transaction: record.transaction,
      status: "Consent required",
    })),
    ...(visits || []).map((visit) => ({
      id: `visit-${visit.id}`,
      at: visit.createdAt || "",
      title: "Visit reference",
      detail: visit.recordReference,
      hash: visit.recordHash,
      transaction: null,
      status: "Off-chain reference",
    })),
  ].sort((left, right) => String(left.at).localeCompare(String(right.at)));
}

export function PatientHistoryPage() {
  const visitsState = usePortalGet("/patient-portal/visits");
  const recordsState = usePortalGet("/patient-portal/records");
  const loading = visitsState.phase === "loading" || recordsState.phase === "loading";
  const failed = visitsState.phase === "error" ? visitsState : recordsState.phase === "error" ? recordsState : null;
  const entries = timelineEntries(recordsState.data?.records, visitsState.data?.visits);
  return (
    <div>
      <PortalHeader
        title="Visit history"
        description="Clinical entries and visit references for this patient, in date order. Hashes stay unanchored until the patient controller grants consent."
        badge={<StatusBadge tone="warning">Not anchored</StatusBadge>}
      />
      {loading ? <LoadingSkeleton label="Loading visit history" /> : null}
      {failed ? (
        <ErrorState title="Visit history unavailable" message={failed.message} action={<Button onClick={failed.retry}>Try again</Button>} />
      ) : null}
      {!loading && !failed && entries.length === 0 ? (
        <Card>
          <EmptyState title="No history yet" description="No clinical entry or visit reference is stored for this patient." />
        </Card>
      ) : null}
      {!loading && !failed && entries.length > 0 ? (
        <Card title="Timeline">
          <ol className="space-y-5 border-l border-line pl-5">
            {entries.map((entry) => {
              const explorer = sepoliaTransactionUrl(entry.transaction);
              return (
                <li key={entry.id} className="relative">
                  <span className="absolute top-1.5 -left-[1.45rem] h-2.5 w-2.5 rounded-full bg-teal" aria-hidden="true" />
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-navy capitalize">{entry.title}</p>
                    <StatusBadge tone="warning">{entry.status}</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{entry.at ? new Date(entry.at).toLocaleString() : "Time unavailable"}</p>
                  {entry.detail ? <p className="mt-2 text-sm leading-6 text-ink">{entry.detail}</p> : null}
                  {entry.hash ? <p className="mt-1 break-all text-xs text-muted">{entry.hash}</p> : null}
                  {explorer ? <a className="mt-1 inline-flex break-all text-xs text-teal" href={explorer} target="_blank" rel="noreferrer">{entry.transaction}</a> : null}
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}

export function PatientRecordsPage() {
  const state = usePortalGet("/patient-portal/records");
  const records = state.data?.records || [];
  return (
    <div>
      <PortalHeader
        title="Medical records"
        description="Encrypted clinical entries for this patient. Verification on Sepolia is not submitted by the hospital wallet."
        badge={<StatusBadge tone="warning">Consent required</StatusBadge>}
      />
      {state.phase === "loading" ? <LoadingSkeleton label="Loading medical records" /> : null}
      {state.phase === "error" ? <ErrorState title="Medical records unavailable" message={state.message} action={<Button onClick={state.retry}>Try again</Button>} /> : null}
      {state.phase === "ready" && records.length === 0 ? (
        <Card>
          <EmptyState title="No medical records" description={state.data.message} />
        </Card>
      ) : null}
      {state.phase === "ready" && records.length > 0 ? (
        <Card title="Stored records">
          <ol className="space-y-5">
            {records.map((record) => {
              const explorer = sepoliaTransactionUrl(record.transaction);
              return (
                <li key={record.id} className="border-b border-line pb-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium capitalize text-navy">{record.category}</p>
                    <StatusBadge tone={anchorTone(anchorLabel(record))}>{anchorLabel(record)}</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{record.recordedOn} · version {record.versionIndex}</p>
                  <p className="mt-2 text-sm leading-6 text-ink">{Object.entries(record.content || {}).filter(([key]) => key !== "category" && key !== "recordedOn").map(([, value]) => value).join(" · ")}</p>
                  <p className="mt-1 break-all text-xs text-muted">{record.contentHash}</p>
                  {record.chainStatus === "anchored" && explorer ? <a className="text-xs text-teal" href={explorer} target="_blank" rel="noreferrer">{record.transaction}</a> : <p className="text-xs text-muted">{record.transaction ? "Anchor confirmation is still pending." : "No confirmed Sepolia transaction."}</p>}
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}

function expiryLabel(expiresAt) {
  if (!expiresAt) return "Until revoked";
  return new Date(Number(expiresAt) * 1000).toLocaleString();
}

function doctorForWallet(doctors, wallet) {
  return doctors.find((doctor) => doctor.walletAddress.toLowerCase() === String(wallet || "").toLowerCase()) || null;
}

function expirySeconds(expiresOn) {
  if (!expiresOn) return 0;
  const expiresAt = Math.floor(Date.parse(`${expiresOn}T23:59:59Z`) / 1000);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) return null;
  return expiresAt;
}

export function PatientAccessPage() {
  const state = usePortalGet("/patient-portal/access");
  const [doctors, setDoctors] = useState([]);
  const [doctorWallet, setDoctorWallet] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [tx, setTx] = useState(null);
  const [notice, setNotice] = useState("");
  const sendLock = useRef(false);
  const permissions = state.data?.permissions || [];
  const emergency = state.data?.emergency || [];
  const audit = state.data?.audit || [];
  const grantingDisabled = state.data?.grantingDisabled !== false;
  const selectedDoctor = doctorForWallet(doctors, doctorWallet);
  const sending = tx?.phase === "pending";

  useEffect(() => {
    let active = true;
    apiClient.request("/patient-portal/clinicians").then(
      (data) => {
        if (active) setDoctors(Array.isArray(data?.clinicians) ? data.clinicians : []);
      },
      (error) => {
        if (!active) return;
        setDoctors([]);
        setNotice(error instanceof ApiError ? messageForRequest(error) : "Verified doctors could not be loaded.");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  function rejected(error) {
    return error?.code === 4001 || error?.code === "wallet_rejected";
  }

  async function submitConsent({ action, wallet, data }) {
    if (sendLock.current || grantingDisabled) return;
    const ethereum = globalThis.window?.ethereum;
    sendLock.current = true;
    setNotice("");
    setTx({ action, wallet, phase: "pending", hash: "", message: action === "grant" ? "Checking the selected doctor." : "Waiting for MetaMask approval. Nothing is signed automatically." });
    try {
      if (action === "grant") {
        await apiClient.request("/patient-portal/clinicians/authorization", { method: "POST", body: { walletAddress: wallet } });
      }
      setTx({ action, wallet, phase: "pending", hash: "", message: "Approve the transaction in MetaMask. It is not signed automatically." });
      await ensurePatientSepolia();
      const nextChain = Number(await ethereum.request({ method: "eth_chainId" }));
      const target = contractForPatient("consent", nextChain, state.data?.recordAccessAddress || "", import.meta.env?.VITE_LOCAL_RECORD_ACCESS);
      if (!target || !data) throw new Error("The consent transaction could not be prepared.");
      const hash = await sendPreparedTransaction({ chainId: nextChain, contractAddress: target, data, ethereum });
      setTx({ action, wallet, phase: "pending", hash, message: "Transaction submitted. Waiting for Sepolia confirmation." });
      const receipt = await waitForReceipt(ethereum, hash);
      if (!receipt) {
        setTx({ action, wallet, phase: "pending", hash, message: "The transaction was submitted. Confirmation is still pending." });
        return;
      }
      if (receipt.status === "0x1" || receipt.status === 1) {
        setTx({ action, wallet, phase: "confirmed", hash, message: action === "grant" ? "Access was granted." : "Access was revoked." });
        return;
      }
      setTx({ action, wallet, phase: "failed", hash, message: "The transaction failed on Sepolia. No access change was confirmed." });
    } catch (error) {
      const phase = rejected(error) ? "rejected" : "failed";
      const message = rejected(error)
        ? "MetaMask did not approve the request. Nothing was sent."
        : error instanceof ApiError
          ? messageForRequest(error)
          : error?.message || "The consent transaction was not sent.";
      setTx({ action, wallet, phase, hash: "", message });
    } finally {
      sendLock.current = false;
    }
  }

  function grantAccess(event) {
    event.preventDefault();
    const patientRef = state.data?.patientRef;
    const expiresAt = expirySeconds(expiresOn);
    if (grantingDisabled || !selectedDoctor || !patientRef) {
      setNotice("Choose a verified doctor. Only the patient controller wallet can grant access.");
      return;
    }
    if (expiresAt === null) {
      setNotice("Choose an expiry in the future, or leave it empty to keep the grant until you revoke it.");
      return;
    }
    const data = grantCalldata(patientRef, selectedDoctor.walletAddress, expiresAt);
    if (!data) {
      setNotice("The grant could not be prepared.");
      return;
    }
    submitConsent({ action: "grant", wallet: selectedDoctor.walletAddress, data });
  }

  function revokeAccess(wallet) {
    const data = revokeCalldata(state.data?.patientRef, wallet);
    if (!data) {
      setNotice("The revocation could not be prepared.");
      return;
    }
    submitConsent({ action: "revoke", wallet, data });
  }

  return (
    <div>
      <PortalHeader
        title="Access permissions"
        description="Consent can be granted only by the patient controller wallet. The hospital wallet cannot grant it."
        badge={<StatusBadge tone={permissions.some((item) => item.active) ? "success" : "warning"}>{state.data?.status === "active" ? "Active" : "Consent required"}</StatusBadge>}
      />
      <VerificationNotice>
        Grants and revocations are sent by the patient controller wallet. MetaMask must approve each Sepolia transaction. The hospital wallet cannot grant or revoke consent.
      </VerificationNotice>
      {state.phase === "loading" ? <LoadingSkeleton label="Loading access permissions" /> : null}
      {state.phase === "error" ? <ErrorState title="Access permissions unavailable" message={state.message} action={<Button onClick={state.retry}>Try again</Button>} /> : null}
      {state.phase === "ready" && permissions.length === 0 ? (
        <Card>
          <EmptyState title="No access permissions" description={state.data.message} />
        </Card>
      ) : null}
      {state.phase === "ready" && permissions.length > 0 ? (
        <Card title="Clinical wallets">
          <ul className="space-y-4">
            {permissions.map((permission) => {
              const doctor = doctorForWallet(doctors, permission.wallet);
              return (
                <li key={permission.wallet} className="border-b border-line pb-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={permission.status === "active" ? "success" : "warning"}>{permission.status}</StatusBadge>
                    <p className="text-sm text-ink">{permission.expiresAt ? expiryLabel(permission.expiresAt) : "Until revoked"}</p>
                  </div>
                  <p className="mt-1 text-sm text-ink">{doctor ? doctor.name : "Clinical wallet"} · {shortWallet(permission.wallet)}</p>
                  <Button className="mt-2" type="button" variant="secondary" disabled={grantingDisabled || sending || permission.status !== "active"} onClick={() => revokeAccess(permission.wallet)}>
                    Revoke access in MetaMask
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      {state.phase === "ready" ? (
        <Card className="mt-4" title="Grant access">
          <form className="max-w-lg space-y-4" onSubmit={grantAccess}>
            <Select label="Doctor" name="doctor" value={doctorWallet} onChange={(event) => setDoctorWallet(event.target.value)} hint="Active doctors with a verified clinical wallet.">
              <option value="">Select a doctor</option>
              {doctors.map((doctor) => (
                <option key={doctor.walletAddress} value={doctor.walletAddress}>{clinicianLabel(doctor)}</option>
              ))}
            </Select>
            <Input label="Expiry date" name="expiresOn" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} hint="Optional. Empty means the grant lasts until you revoke it." />
            {selectedDoctor ? (
              <dl className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">
                <div className="flex justify-between gap-3"><dt>Doctor</dt><dd>{selectedDoctor.name}</dd></div>
                <div className="flex justify-between gap-3"><dt>Role</dt><dd>{selectedDoctor.role}</dd></div>
                <div className="flex justify-between gap-3"><dt>Wallet</dt><dd>{shortWallet(selectedDoctor.walletAddress)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Action</dt><dd>Grant record access on Sepolia</dd></div>
                <div className="flex justify-between gap-3"><dt>Expires</dt><dd>{expiresOn || "Until you revoke it"}</dd></div>
              </dl>
            ) : null}
            {doctors.length === 0 ? <p className="text-sm leading-6 text-ink">No verified doctor is available yet. A hospital administrator must activate a doctor wallet first.</p> : null}
            {notice ? <p role="status" className="text-sm leading-6 text-ink">{notice}</p> : null}
            {tx ? (
              <div role="status" className="space-y-1">
                <StatusBadge tone={tx.phase === "confirmed" ? "success" : tx.phase === "failed" || tx.phase === "rejected" ? "danger" : "warning"}>{tx.phase}</StatusBadge>
                <p className="text-sm leading-6 text-ink">{tx.message}</p>
                {sepoliaTransactionUrl(tx.hash) ? <a className="text-sm font-medium text-teal-dark underline" href={sepoliaTransactionUrl(tx.hash)} target="_blank" rel="noreferrer">View transaction on Sepolia</a> : null}
              </div>
            ) : null}
            <Button type="submit" loading={sending && tx?.action === "grant"} disabled={grantingDisabled || sending || !selectedDoctor}>Grant access with MetaMask</Button>
            <p className="text-xs leading-5 text-muted">MetaMask must approve this transaction. The patient controller wallet signs it, and the hospital wallet is not used.</p>
          </form>
        </Card>
      ) : null}
      {state.phase === "ready" ? (
        <Card className="mt-4" title="Emergency sessions">
          {emergency.length === 0 ? (
            <EmptyState title="No emergency session" description="Active and historical emergency access appears here when the chain reports it." />
          ) : (
            <ul className="space-y-4">
              {emergency.map((session) => (
                <li key={`${session.wallet}-${session.expiresAt}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={session.active ? "danger" : "warning"}>{session.status}</StatusBadge>
                    <p className="text-sm text-ink">{expiryLabel(session.expiresAt)}</p>
                  </div>
                  <p className="mt-1 break-all text-xs text-muted">{session.wallet}</p>
                  {session.reason ? <p className="mt-1 text-sm leading-6 text-ink">{session.reason}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      {state.phase === "ready" && audit.length > 0 ? (
        <Card className="mt-4" title="Audit history">
          <ul className="space-y-3">
            {audit.map((entry, index) => (
              <li key={`${entry.action}-${entry.timestamp}-${index}`} className="text-sm leading-6 text-ink">
                <span className="font-medium text-navy">{entry.action}</span>
                <span className="mt-1 block break-all text-xs text-muted">{entry.actor} · {entry.source}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

const PROFILE_LABELS = [
  ["fullName", "Full name"],
  ["dateOfBirth", "Date of birth"],
  ["mobile", "Mobile"],
  ["email", "Email"],
  ["emergencyContact", "Emergency contact"],
];

export function PatientProfilePage() {
  const state = usePortalGet("/patient-portal/profile");
  const profile = state.data?.profile || {};
  const present = PROFILE_LABELS.filter(([key]) => profile[key]);
  return (
    <div>
      <PortalHeader
        title="Profile"
        description="Details stored for this patient in the hospital database. They are not written to the blockchain."
      />
      {state.phase === "loading" ? <LoadingSkeleton label="Loading profile" /> : null}
      {state.phase === "error" ? <ErrorState title="Profile unavailable" message={state.message} action={<Button onClick={state.retry}>Try again</Button>} /> : null}
      {state.phase === "ready" && present.length === 0 ? (
        <Card>
          <EmptyState title="No profile details" description="No profile fields are available for this patient." />
        </Card>
      ) : null}
      {state.phase === "ready" && present.length > 0 ? (
        <Card title={state.data.patientId}>
          <dl className="grid gap-4 sm:grid-cols-2">
            {present.map(([key, label]) => (
              <div key={key}>
                <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
                <dd className="mt-1 text-sm text-ink">{profile[key]}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
