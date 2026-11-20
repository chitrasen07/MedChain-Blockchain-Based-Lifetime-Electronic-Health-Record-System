import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandLockup } from "../../components/BrandMark";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { useAuth } from "../../context/useAuth";
import { ApiError } from "../../lib/api";
import { connectPatientWallet, signPatientLogin } from "../../lib/patientWallet";
import { OwnershipClaimPanel } from "../../features/OwnershipClaimPanel";
import { homeForRole } from "../../lib/roles";
import { patientAuthMessage } from "../../services/patientPortal";

const patientIdPattern = /^PATIENT-[0-9]{1,12}$/;

export function PatientLoginPage() {
  const navigate = useNavigate();
  const { loginPatient, isAuthenticated, user } = useAuth();
  const [patientId, setPatientId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
                A wallet linked during registration can sign in now. A record created with a recovery code uses the claim below: check the code, announce, wait one hour, reveal, then sign in.
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

            <OwnershipClaimPanel patientId={patientId} walletAddress={walletAddress} />
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
