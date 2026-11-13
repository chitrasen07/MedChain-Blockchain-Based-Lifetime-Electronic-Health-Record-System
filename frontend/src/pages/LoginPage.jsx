import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BrandLockup } from "../components/BrandMark";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { useAuth } from "../context/useAuth";
import { ApiError, messageForAuthFailure } from "../lib/api";
import { homeForRole, pathAllowedForRole } from "../lib/roles";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, user, notice: sessionNotice, clearNotice } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });
  const [formNotice, setFormNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Staff login · MedChain";
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const attempted = location.state?.from;
    navigate(pathAllowedForRole(user.role, attempted) ? attempted : homeForRole(user.role), { replace: true });
  }, [isAuthenticated, user, navigate, location.state]);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormNotice("");
    const next = { email: "", password: "" };
    const trimmedEmail = email.trim();
    if (!trimmedEmail) next.email = "Enter your work email.";
    else if (!emailPattern.test(trimmedEmail)) next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    else if (password.length < 8) next.password = "Use at least 8 characters.";
    setFieldErrors(next);
    if (next.email || next.password) return;
    clearNotice();

    setSubmitting(true);
    try {
      await login(trimmedEmail, password);
    } catch (error) {
      setFormNotice(error instanceof ApiError ? messageForAuthFailure(error) : "Sign-in could not be completed. Try again later.");
    } finally {
      setSubmitting(false);
    }
  }

  const notice = formNotice || sessionNotice;

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="hidden flex-col justify-between bg-navy-deep px-10 py-10 text-white lg:flex xl:px-14">
        <BrandLockup tone="inverse" subtitle="Hospital staff" />
        <div className="max-w-md">
          <p className="text-[11px] font-medium tracking-[0.14em] text-teal uppercase">Staff access</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">Sign in with the account your hospital issued.</p>
          <p className="mt-4 text-sm leading-7 text-white/70">
            MedChain uses that account to decide which workspace you can open. Clinical charts stay off the blockchain.
            This page does not accept a wallet and it does not let you choose a role.
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
            <BrandLockup subtitle="Hospital staff" hideSubtitleOnMobile />
          </div>
          <Link to="/" className="shrink-0 text-sm font-medium text-teal hover:text-teal-dark">
            <span className="sm:hidden">Welcome</span>
            <span className="hidden sm:inline">Back to welcome</span>
          </Link>
        </div>
        <div className="flex flex-1 items-center px-4 py-8 sm:px-8">
          <div className="mx-auto w-full max-w-md rounded-xl border border-line bg-surface px-5 py-6 shadow-[0_1px_2px_rgba(13,33,56,0.04)] sm:px-7 sm:py-8">
            <h1 className="text-2xl font-semibold tracking-tight text-balance text-navy">Welcome back</h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              Use the work email created by a hospital administrator. There is no demo account on this page.
            </p>
            <form className="mt-7 space-y-4" onSubmit={handleSubmit} noValidate>
              <Input
                label="Email"
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                error={fieldErrors.email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@hospital.org"
              />
              <Input
                label="Password"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                error={fieldErrors.password}
                onChange={(event) => setPassword(event.target.value)}
                hint="At least 8 characters, matching the staff sign-in API."
              />
              {notice ? (
                <p role={formNotice ? "alert" : "status"} className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">
                  {notice}
                </p>
              ) : null}
              <Button type="submit" className="w-full" loading={submitting} disabled={submitting}>
                Sign in
              </Button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
