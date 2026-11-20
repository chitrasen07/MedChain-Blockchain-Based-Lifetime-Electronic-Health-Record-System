import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandLockup } from "../../components/BrandMark";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { useAuth } from "../../context/useAuth";
import { ApiError } from "../../lib/api";
import { connectPatientWallet, signPatientLogin } from "../../lib/patientWallet";
import { claimCommitmentForRecoveryCode, sealedClaimForRecoveryCode } from "../../lib/ownership";
import { homeForRole } from "../../lib/roles";
import { claimStatusBody, patientAuthMessage } from "../../services/patientPortal";
import { apiClient } from "../../lib/api";

const patientIdPattern = /^PATIENT-[0-9]{1,12}$/;

export function PatientLoginPage() {
  const navigate = useNavigate();
  const { loginPatient, isAuthenticated, user } = useAuth();
  const [patientId, setPatientId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [notice, setNotice] = useState("");
  const [claimNotice, setClaimNotice] = useState("");
  const [sealedClaim, setSealedClaim] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    document.title = "Patient login · MedChain";
  }, []);

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

  async function handleSignIn(event) {
    event.preventDefault();
    setNotice("");
    setClaimNotice("");
    const id = patientId.trim().toUpperCase();
    if (!patientIdPattern.test(id)) {
      setNotice("Enter a lifetime patient ID such as PATIENT-000001.");
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      setNotice("Connect the wallet that controls this record.");
      return;
    }
    setSubmitting(true);
    try {
      await loginPatient({
        patientId: id,
        walletAddress,
        signMessage: (message) => signPatientLogin(message, walletAddress),
      });
    } catch (error) {
      setNotice(patientAuthMessage(error instanceof ApiError ? error : error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClaimCheck(event) {
    event.preventDefault();
    setClaimNotice("");
    setSealedClaim("");
    const id = patientId.trim().toUpperCase();
    const code = recoveryCode.trim();
    if (!patientIdPattern.test(id)) {
      setClaimNotice("Enter a lifetime patient ID such as PATIENT-000001.");
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      setClaimNotice("Connect the wallet that should become the controller.");
      return;
    }
    const claimCommitment = claimCommitmentForRecoveryCode(code);
    if (!claimCommitment) {
      setClaimNotice("Enter the recovery code saved at registration. It stays in this browser.");
      return;
    }
    setRecoveryCode("");
    setChecking(true);
    try {
      const result = await apiClient.request("/patient-auth/claim-status", {
        method: "POST",
        body: claimStatusBody({ patientId: id, walletAddress, claimCommitment }),
        authenticated: false,
      });
      if (result?.status === "unclaimed" && result.patientRef) {
        setSealedClaim(sealedClaimForRecoveryCode(code, walletAddress, result.patientRef));
      }
      setClaimNotice(result?.message || "The ownership check finished. No transaction was sent.");
    } catch (error) {
      setClaimNotice(patientAuthMessage(error instanceof ApiError ? error : error));
    } finally {
      setChecking(false);
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
            MedChain asks the wallet to sign a one-time challenge. The signature is checked against the Sepolia
            controller. This page does not send a transaction, and it does not accept a recovery secret on the server.
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
                Use the lifetime patient ID and the controller wallet. A record without a wallet can be checked below,
                but the chain claim is not submitted.
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
                {notice ? (
                  <p role="alert" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">
                    {notice}
                  </p>
                ) : null}
                <Button type="submit" className="w-full" loading={submitting} disabled={submitting}>
                  Sign in
                </Button>
              </div>
            </form>

            <form className="rounded-xl border border-line bg-surface px-5 py-6 sm:px-7" onSubmit={handleClaimCheck} noValidate>
              <h2 className="text-base font-semibold text-navy">Ownership claim</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                The recovery code is used only in this browser to build the claim commitment. It is removed from the
                page before the check is sent.
              </p>
              <div className="mt-4 space-y-4">
                <Input
                  label="Recovery code"
                  type="password"
                  name="recoveryCode"
                  autoComplete="off"
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  hint="Not sent to the hospital service."
                />
                {claimNotice ? (
                  <p role="status" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">
                    {claimNotice}
                  </p>
                ) : null}
                {sealedClaim ? (
                  <p className="break-all text-xs leading-5 text-muted">
                    Sealed claim prepared in this browser: {sealedClaim}. It was not sent to Sepolia.
                  </p>
                ) : null}
                <Button type="submit" variant="secondary" className="w-full" loading={checking} disabled={checking}>
                  Check recovery code
                </Button>
              </div>
            </form>
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
