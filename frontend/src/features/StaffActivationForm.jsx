import { useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { ApiError, messageForRequest } from "../lib/api";
import { ensurePatientSepolia, connectPatientWallet, signPatientLogin } from "../lib/patientWallet";
import { adminService } from "../services/adminService";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const codePattern = /^[a-f0-9]{32}$/i;

function activationMessage(error) {
  if (error?.code === 4001 || error?.code === "wallet_rejected") return "MetaMask rejected the wallet link. No role transaction was sent.";
  if (error instanceof ApiError) return messageForRequest(error);
  return error?.message || "The account could not be activated.";
}

export function StaffActivationForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [walletNeeded, setWalletNeeded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function fields() {
    const next = {};
    const trimmedEmail = email.trim();
    const normalized = code.toLowerCase().replace(/[^a-f0-9]/g, "");
    if (!emailPattern.test(trimmedEmail)) next.email = "Enter the registered work email.";
    if (!codePattern.test(normalized)) next.code = "Enter the activation code from the hospital administrator.";
    if (password.length < 12) next.password = "Use at least 12 characters.";
    if (password !== confirm) next.confirm = "Enter the same password again.";
    return { next, trimmedEmail, normalized };
  }

  async function activate(walletProof) {
    const { next, trimmedEmail, normalized } = fields();
    setErrors(next);
    if (Object.keys(next).length) return;
    setSubmitting(true);
    setNotice("");
    try {
      const result = await adminService.activateStaff({
        email: trimmedEmail,
        activationCode: normalized,
        password,
        walletProof,
      });
      setWalletNeeded(false);
      setPassword("");
      setConfirm("");
      setCode("");
      setNotice(result.authorization?.status === "pending"
        ? "The account is activated and the wallet is verified. Sign in after a hospital administrator approves the blockchain role. Clinical access stays closed until that approval."
        : "The account is activated. Sign in with the work email and the password you chose.");
    } catch (error) {
      if (error instanceof ApiError && error.message === "Connect the staff wallet before activating this account.") {
        setWalletNeeded(true);
        setNotice("This role needs the staff member's own MetaMask wallet. Connect it on Sepolia, then verify the account. No role transaction is sent.");
        return;
      }
      setNotice(activationMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function connectAndActivate() {
    const { next } = fields();
    setErrors(next);
    if (Object.keys(next).length) return;
    setSubmitting(true);
    setNotice("");
    try {
      await ensurePatientSepolia();
      const address = await connectPatientWallet();
      const challenge = await adminService.activationChallenge({
        email: email.trim(),
        activationCode: code.toLowerCase().replace(/[^a-f0-9]/g, ""),
        walletAddress: address,
      });
      const signature = await signPatientLogin(challenge.message, address);
      setSubmitting(false);
      await activate({ nonce: challenge.nonce, signature });
    } catch (error) {
      setNotice(activationMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-7 space-y-4" onSubmit={(event) => { event.preventDefault(); activate(); }} noValidate>
      <Input label="Work email" type="email" name="email" autoComplete="username" value={email} error={errors.email} onChange={(event) => setEmail(event.target.value)} placeholder="name@hospital.org" />
      <Input label="Activation code" name="activationCode" autoComplete="one-time-code" value={code} error={errors.code} onChange={(event) => setCode(event.target.value)} hint="The code the hospital administrator shared. Dashes are optional." />
      <Input label="New password" type="password" name="new-password" autoComplete="new-password" value={password} error={errors.password} onChange={(event) => setPassword(event.target.value)} hint="At least 12 characters." />
      <Input label="Confirm password" type="password" name="confirm-password" autoComplete="new-password" value={confirm} error={errors.confirm} onChange={(event) => setConfirm(event.target.value)} />
      {walletNeeded ? (
        <div>
          <p className="text-sm leading-6 text-muted">Connect the staff member's MetaMask account on Sepolia. The hospital administrator wallet cannot be used.</p>
          <Button className="mt-3 w-full" type="button" variant="secondary" onClick={connectAndActivate} loading={submitting} disabled={submitting}>
            Connect MetaMask wallet
          </Button>
        </div>
      ) : null}
      {notice ? <p role="status" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
      <Button type="submit" className="w-full" loading={submitting} disabled={submitting}>
        Verify and activate account
      </Button>
    </form>
  );
}
