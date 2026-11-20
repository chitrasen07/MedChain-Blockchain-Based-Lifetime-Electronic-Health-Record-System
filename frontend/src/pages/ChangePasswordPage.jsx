import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../context/useAuth";
import { ApiError, apiClient, messageForRequest } from "../lib/api";
import { passwordProblems, passwordStrength } from "../lib/passwordChange";

const PASSWORD_CHANGED = "Your password was changed. Sign in with the new password. Other sessions for this account are no longer accepted.";

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const strength = passwordStrength(newPassword);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    const problems = passwordProblems({ currentPassword, newPassword, confirmPassword });
    setFieldErrors(problems);
    if (problems.currentPassword || problems.newPassword || problems.confirmPassword) return;

    setSubmitting(true);
    try {
      await apiClient.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      logout(PASSWORD_CHANGED);
      navigate("/login", { replace: true });
    } catch (error) {
      setFormError(error instanceof ApiError ? messageForRequest(error) : "The password could not be changed. Try again later.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-lg">
      <PageHeader
        eyebrow="Account"
        title="Change password"
        description="This updates only the signed-in staff account. A successful change asks you to sign in again and ends other sessions for this account."
      />
      <form className="rounded-xl border border-line bg-surface px-4 py-5 shadow-[0_1px_2px_rgba(13,33,56,0.04)] sm:px-6 sm:py-6" onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
          <Input
            label="Current password"
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            value={currentPassword}
            error={fieldErrors.currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <div>
            <Input
              label="New password"
              type="password"
              name="newPassword"
              autoComplete="new-password"
              value={newPassword}
              error={fieldErrors.newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              hint="At least 12 characters, including a letter and a number."
            />
            {newPassword ? (
              <div className="mt-2" aria-live="polite">
                <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className={strength.score <= 1 ? "h-full w-1/4 bg-danger" : strength.score === 2 ? "h-full w-2/4 bg-teal/70" : "h-full w-full bg-teal"}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted">Strength: {strength.label}</p>
              </div>
            ) : null}
          </div>
          <Input
            label="Confirm new password"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            value={confirmPassword}
            error={fieldErrors.confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
        {formError ? (
          <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-canvas px-3 py-2 text-sm leading-6 text-danger">
            {formError}
          </p>
        ) : null}
        <Button type="submit" className="mt-5 w-full sm:w-auto" loading={submitting} disabled={submitting}>
          Update password
        </Button>
      </form>
    </section>
  );
}
