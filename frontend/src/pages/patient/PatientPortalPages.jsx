import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { LoadingSkeleton } from "../../components/LoadingSkeleton";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { VerificationNotice } from "../../components/VerificationNotice";
import { ApiError, apiClient, messageForRequest } from "../../lib/api";
import { SEPOLIA_CHAIN_ID, claimBroadcastAllowed, sendPatientClaim } from "../../lib/claimChain";
import { grantCalldata, revokeCalldata, sendPreparedTransaction, transactionTarget } from "../../lib/consentChain";
import { claimCommitmentForRecoveryCode, sealedClaimForRecoveryCode, sepoliaTransactionUrl } from "../../lib/ownership";
import { useAuth } from "../../context/useAuth";
import { claimStatusBody, patientAuthMessage } from "../../services/patientPortal";

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
    setRecoveryCode("");
    setChecking(true);
    try {
      const result = await apiClient.request("/patient-auth/claim-status", {
        method: "POST",
        body: claimStatusBody({
          patientId: state.data.patientId,
          walletAddress: user.walletAddress,
          claimCommitment,
        }),
        authenticated: false,
      });
      if (result?.status === "unclaimed" && result.patientRef) {
        setSealedClaim(sealedClaimForRecoveryCode(code, user.walletAddress, result.patientRef));
      }
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
    if (kind === "reveal" && !window.confirm("Revealing publishes the recovery code in the transaction. Continue only if you approve it in MetaMask.")) return;
    try {
      await sendPatientClaim({
        kind,
        patientRef,
        value,
        registryAddress: import.meta.env?.VITE_LOCAL_PATIENT_REGISTRY,
        chainId,
        ethereum: globalThis.window?.ethereum,
      });
      setNotice(kind === "announce"
        ? "The announcement was submitted. Reveal stays locked until the contract waiting period ends."
        : "The reveal was submitted. Sign in again after it is confirmed.");
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
            The contract can assign this wallet only after an announcement and a one-hour wait. Those transactions are
            not sent from this portal. The recovery code is not included in the request.
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
            {sealedClaim ? (
              <p className="break-all text-xs leading-5 text-muted">Sealed claim prepared locally: {sealedClaim}</p>
            ) : null}
            <Button type="submit" loading={checking} disabled={checking}>
              Check recovery code
            </Button>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" disabled={!broadcastAllowed || !sealedClaim} onClick={() => broadcastClaim("announce")}>
                Announce claim
              </Button>
              <Button type="button" variant="secondary" disabled={!broadcastAllowed || !recoveryCode.trim()} onClick={() => broadcastClaim("reveal")}>
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
                    <StatusBadge tone="warning">Not anchored</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{record.recordedOn} · version {record.versionIndex}</p>
                  <p className="mt-2 text-sm leading-6 text-ink">{Object.entries(record.content || {}).filter(([key]) => key !== "category" && key !== "recordedOn").map(([, value]) => value).join(" · ")}</p>
                  <p className="mt-1 break-all text-xs text-muted">{record.contentHash}</p>
                  {explorer ? <a className="text-xs text-teal" href={explorer} target="_blank" rel="noreferrer">{record.transaction}</a> : <p className="text-xs text-muted">No transaction reference.</p>}
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

export function PatientAccessPage() {
  const state = usePortalGet("/patient-portal/access");
  const [staffWallet, setStaffWallet] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [prepared, setPrepared] = useState("");
  const [notice, setNotice] = useState("");
  const [chainId, setChainId] = useState(null);
  const consentTarget = transactionTarget("consent", chainId, import.meta.env?.VITE_LOCAL_RECORD_ACCESS);
  const broadcastAllowed = Boolean(consentTarget);
  const permissions = state.data?.permissions || [];
  const emergency = state.data?.emergency || [];
  const audit = state.data?.audit || [];
  const grantingDisabled = state.data?.grantingDisabled !== false;

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

  function prepareGrant(event) {
    event.preventDefault();
    setPrepared("");
    setNotice("");
    const patientRef = state.data?.patientRef;
    if (grantingDisabled || !patientRef || !/^0x[0-9a-fA-F]{40}$/.test(staffWallet.trim())) {
      setNotice("Consent can be prepared only by the controller, for a clinical wallet.");
      return;
    }
    const expiresAt = expiresOn ? Math.floor(Date.parse(`${expiresOn}T23:59:59Z`) / 1000) : 0;
    if (expiresOn && (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now())) {
      setNotice("Choose an expiry in the future, or leave it empty to keep the grant until you revoke it.");
      return;
    }
    const data = grantCalldata(patientRef, staffWallet.trim(), expiresAt);
    if (!data) {
      setNotice("The grant could not be prepared.");
      return;
    }
    setPrepared(data);
    setNotice("The grant is prepared. MetaMask will ask the patient wallet to approve it.");
  }

  async function useSepolia() {
    setNotice("");
    try {
      await globalThis.window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
      setChainId(SEPOLIA_CHAIN_ID);
      setNotice("The wallet is on Sepolia. No consent transaction has been sent.");
    } catch (error) {
      setNotice(error?.code === 4001 ? "MetaMask did not approve the network change." : error?.message || "The wallet was not switched.");
    }
  }

  async function sendPrepared(data) {
    try {
      await sendPreparedTransaction({
        chainId,
        contractAddress: consentTarget,
        data,
        ethereum: globalThis.window?.ethereum,
      });
      setNotice("The consent transaction was submitted. MetaMask approval was required.");
    } catch (error) {
      setNotice(error?.message || "The consent transaction was not sent.");
    }
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
              const revoke = revokeCalldata(state.data.patientRef, permission.wallet);
              return (
                <li key={permission.wallet} className="border-b border-line pb-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={permission.status === "active" ? "success" : "warning"}>{permission.status}</StatusBadge>
                    <p className="text-sm text-ink">{permission.expiresAt ? expiryLabel(permission.expiresAt) : "Until revoked"}</p>
                  </div>
                  <p className="mt-1 break-all text-xs text-muted">{permission.wallet}</p>
                  <Button className="mt-2" type="button" variant="secondary" disabled={grantingDisabled || !broadcastAllowed || !revoke || permission.status !== "active"} onClick={() => sendPrepared(revoke)}>
                    Revoke consent in MetaMask
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      {state.phase === "ready" ? (
        <Card className="mt-4" title="Grant consent">
          <form className="max-w-lg space-y-4" onSubmit={prepareGrant}>
            <Input label="Clinical wallet" name="staffWallet" value={staffWallet} onChange={(event) => setStaffWallet(event.target.value)} placeholder="0x" hint="The wallet that will read or anchor records." />
            <Input label="Expiry date" name="expiresOn" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} hint="Optional. Empty means the grant lasts until you revoke it." />
            {notice ? <p role="status" className="text-sm leading-6 text-ink">{notice}</p> : null}
            {prepared ? <p className="break-all text-xs leading-5 text-muted">{prepared}</p> : null}
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={useSepolia} disabled={chainId === SEPOLIA_CHAIN_ID}>Use Sepolia</Button>
              <Button type="submit" disabled={grantingDisabled}>Prepare grant</Button>
              <Button type="button" variant="secondary" disabled={grantingDisabled || !broadcastAllowed || !prepared} onClick={() => sendPrepared(prepared)}>
                Approve grant in MetaMask
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted">The controller signs this transaction on the connected network. The hospital wallet is not asked to sign.</p>
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
