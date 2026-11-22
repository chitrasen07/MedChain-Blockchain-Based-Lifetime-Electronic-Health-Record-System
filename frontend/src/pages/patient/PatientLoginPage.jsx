import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandLockup } from "../../components/BrandMark";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { useAuth } from "../../context/useAuth";
import { OwnershipTransferPanel } from "../../features/OwnershipTransferPanel";
import { ApiError, apiClient } from "../../lib/api";
import { connectPatientWallet, signPatientLogin } from "../../lib/patientWallet";
import { OwnershipClaimPanel } from "../../features/OwnershipClaimPanel";
import { homeForRole } from "../../lib/roles";
import { patientAuthMessage, patientRetryLabel } from "../../services/patientPortal";

const patientIdPattern = /^PATIENT-[0-9]{1,12}$/;

export function PatientLoginPage() {
  const navigate = useNavigate();
  const { loginPatient, isAuthenticated, user } = useAuth();
  const [patientId, setPatientId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [notice, setNotice] = useState("");
  const [ownership, setOwnership] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const signInLock = useRef(false);
  const remaining = Math.max(0, Math.ceil((retryAt - clock) / 1000));

  useEffect(() => {
    document.title = "Patient login · MedChain";
  }, []);

  useEffect(() => {
    if (remaining <= 0) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    navigate(user.role === "patient" ? "/patient" : homeForRole(user.role) || "/login", { replace: true });
  }, [isAuthenticated, user, navigate]);

  async function connectWallet() {
    setNotice("");
    try {
      setWalletAddress(await connectPatientWallet());
    } catch (error) {
      setNotice(patientAuthMessage(error));
    }
  }

  async function checkOwnership() {
    setNotice("");
    setOwnership(null);
    const id = patientId.trim().toUpperCase();
    if (!patientIdPattern.test(id)) {
      setNotice("Enter a lifetime patient ID such as PATIENT-000001.");
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      setNotice("Connect the wallet that should control this record.");
      return;
    }
    try {
      const result = await apiClient.request("/patient-auth/ownership-status", {
        method: "POST",
        body: { patientId: id, walletAddress },
        authenticated: false,
      });
      setOwnership(result);
      setNotice(result?.message || "");
    } catch (error) {
      setNotice(patientAuthMessage(error instanceof ApiError ? error : error));
    }
  }

  async function handleSignIn(event) {
    event.preventDefault();
    if (signInLock.current || remaining > 0) return;
    setNotice("");
    const id = patientId.trim().toUpperCase();
    if (!patientIdPattern.test(id)) {
      setNotice("Enter a lifetime patient ID such as PATIENT-000001.");
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      setNotice("Connect the wallet that controls this record.");
      return;
    }
    signInLock.current = true;
    setSubmitting(true);
    try {
      await loginPatient({
        patientId: id,
        walletAddress,
        signMessage: (message) => signPatientLogin(message, walletAddress),
      });
    } catch (error) {
      const failure = error instanceof ApiError ? error : error;
      const seconds = Number(failure?.retryAfterSeconds);
      if (failure?.status === 429 && Number.isInteger(seconds) && seconds > 0) {
        setRetryAt(Date.now() + seconds * 1000);
        setClock(Date.now());
        setNotice("");
      } else {
        setNotice(patientAuthMessage(failure));
      }
    } finally {
      signInLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="hidden flex-col justify-between bg-navy-deep px-10 py-10 text-white lg:flex xl:px-14">
        <BrandLockup tone="inverse" subtitle="Patient portal" />
        <div className="max-w-md">
          <p className="text-[11px] font-medium tracking-[0.14em] text-teal uppercase">Patient access</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">Sign in with the wallet that controls your record.</p>
          <p className="mt-4 text-sm leading-7 text-white/70">
            MedChain asks the wallet to sign a one-time challenge. An unclaimed record can be claimed on Sepolia
            from this page. Each claim transaction needs MetaMask approval, and the recovery code is not sent to the hospital.
          </p>
        </div>
        <p className="text-xs leading-5 text-white/55">
          Signing out clears the session in this browser. It does not revoke the token on the server. The token expires
          15 minutes after sign-in.
        </p>
      </section>

      <section className="flex flex-col bg-canvas">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 sm:px-8 lg:flex lg:justify-end">
          <div className="min-w-0 lg:hidden">
            <BrandLockup subtitle="Patient portal" hideSubtitleOnMobile />
          </div>
          <Link to="/" className="shrink-0 text-sm font-medium text-teal hover:text-teal-dark">
            Back to welcome
          </Link>
        </div>
        <div className="flex flex-1 items-center px-4 py-8 sm:px-8">
          <div className="mx-auto w-full max-w-md space-y-4">
            <form className="rounded-xl border border-line bg-surface px-5 py-6 shadow-[0_1px_2px_rgba(13,33,56,0.04)] sm:px-7 sm:py-8" onSubmit={handleSignIn} noValidate>
              <h1 className="text-2xl font-semibold tracking-tight text-navy">Patient sign-in</h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                A wallet linked during registration can sign in now. A record created with a recovery code keeps the same Patient ID: check the code below, and reveal only after the contract waiting period. Do not register a second ID.
              </p>
              <div className="mt-7 space-y-4">
                <Input
                  label="Lifetime patient ID"
                  name="patientId"
                  autoComplete="off"
                  value={patientId}
                  onChange={(event) => setPatientId(event.target.value)}
                  placeholder="PATIENT-000001"
                />
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink">Wallet</p>
                  <p className="mb-2 break-all text-sm text-muted">{walletAddress || "No wallet connected."}</p>
                  <Button type="button" variant="secondary" onClick={connectWallet}>
                    Connect wallet
                  </Button>
                </div>
                {remaining > 0 ? (
                  <p role="alert" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">
                    Too many sign-in attempts for this patient. Wait {patientRetryLabel(remaining)} and try again.
                  </p>
                ) : notice ? (
                  <p role="alert" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">
                    {notice}
                  </p>
                ) : null}
                <Button type="button" variant="secondary" className="w-full" onClick={checkOwnership} disabled={submitting || remaining > 0}>
                  Check wallet status
                </Button>
                {ownership?.staffControlled && !ownership.walletIsController ? (
                  <OwnershipTransferPanel mode="accept" patientRef={ownership.patientRef} walletAddress={walletAddress} />
                ) : null}
                <Button type="submit" className="w-full" loading={submitting} disabled={submitting || remaining > 0}>
                  Sign in
                </Button>
              </div>
            </form>

            <OwnershipClaimPanel patientId={patientId} walletAddress={walletAddress} onLinked={setOwnership} />
            <p className="text-center text-sm text-muted">
              Hospital staff use{" "}
              <Link to="/login" className="font-medium text-teal hover:text-teal-dark">
                staff login
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
