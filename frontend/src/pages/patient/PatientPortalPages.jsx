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
import { ApiError, apiClient, messageForRequest } from "../../lib/api";
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
            <Card title="Awaiting later integration">
              <p className="text-sm leading-6 text-muted">
                Medical records and access permissions are not read from the chain yet. Those pages stay empty on purpose.
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

  return (
    <div>
      <PortalHeader
        title="Ownership"
        description="Confirm the controller wallet or prepare an unclaimed recovery locally. MedChain does not broadcast the claim."
      />
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
          </form>
        </Card>
      ) : null}
    </div>
  );
}

export function PatientHistoryPage() {
  const state = usePortalGet("/patient-portal/visits");
  const visits = state.data?.visits || [];
  return (
    <div>
      <PortalHeader
        title="Visit history"
        description="Visit references already stored for this patient. This is not the clinical chart, and chain records are not loaded."
        badge={<StatusBadge tone="warning">Chart not stored</StatusBadge>}
      />
      {state.phase === "loading" ? <LoadingSkeleton label="Loading visit history" /> : null}
      {state.phase === "error" ? <ErrorState title="Visit history unavailable" message={state.message} action={<Button onClick={state.retry}>Try again</Button>} /> : null}
      {state.phase === "ready" && visits.length === 0 ? (
        <Card>
          <EmptyState
            title="No visit references"
            description="No visit reference is stored for this patient. A clinical timeline is not invented here."
          />
        </Card>
      ) : null}
      {state.phase === "ready" && visits.length > 0 ? (
        <Card title="Stored visit references">
          <ol className="space-y-5 border-l border-line pl-5">
            {visits.map((visit) => (
              <li key={visit.id} className="relative">
                <span className="absolute top-1.5 -left-[1.45rem] h-2.5 w-2.5 rounded-full bg-teal" aria-hidden="true" />
                <p className="text-sm font-medium text-navy">{visit.recordReference}</p>
                <p className="mt-1 text-xs text-muted">{visit.createdAt ? new Date(visit.createdAt).toLocaleString() : "Time unavailable"}</p>
                {visit.recordHash ? <p className="mt-1 break-all text-xs text-muted">{visit.recordHash}</p> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}

export function PatientRecordsPage() {
  const state = usePortalGet("/patient-portal/records");
  return (
    <div>
      <PortalHeader
        title="Medical records"
        description="On-chain medical record hashes are not read by the API yet."
        badge={<StatusBadge tone="warning">Awaiting integration</StatusBadge>}
      />
      {state.phase === "loading" ? <LoadingSkeleton label="Loading medical records" /> : null}
      {state.phase === "error" ? <ErrorState title="Medical records unavailable" message={state.message} action={<Button onClick={state.retry}>Try again</Button>} /> : null}
      {state.phase === "ready" ? (
        <Card>
          <EmptyState title="No medical records" description={state.data.message} />
        </Card>
      ) : null}
    </div>
  );
}

export function PatientAccessPage() {
  const state = usePortalGet("/patient-portal/access");
  return (
    <div>
      <PortalHeader
        title="Access permissions"
        description="Consent grants are not read from the chain yet."
        badge={<StatusBadge tone="warning">Awaiting integration</StatusBadge>}
      />
      {state.phase === "loading" ? <LoadingSkeleton label="Loading access permissions" /> : null}
      {state.phase === "error" ? <ErrorState title="Access permissions unavailable" message={state.message} action={<Button onClick={state.retry}>Try again</Button>} /> : null}
      {state.phase === "ready" ? (
        <Card>
          <EmptyState title="No access permissions" description={state.data.message} />
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
