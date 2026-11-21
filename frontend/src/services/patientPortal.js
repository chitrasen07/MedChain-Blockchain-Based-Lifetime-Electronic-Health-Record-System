export function shortWallet(address) {
  const value = String(address || "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return "";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function clinicianLabel(clinician) {
  const name = String(clinician?.name || "Doctor");
  const role = String(clinician?.role || "Doctor");
  const wallet = shortWallet(clinician?.walletAddress);
  return wallet ? `${name} · ${role} · ${wallet}` : name;
}

export function claimStatusBody({ patientId, walletAddress, claimCommitment }) {
  return { patientId, walletAddress, claimCommitment };
}

export function patientRetryLabel(seconds) {
  const value = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (!Number.isFinite(value) || value <= 0) return "a few minutes";
  if (value >= 120) return `${Math.ceil(value / 60)} minutes`;
  if (value >= 60) return "1 minute";
  return value === 1 ? "1 second" : `${value} seconds`;
}

export function patientAuthMessage(error) {
  if (error?.code === "wallet_missing" || error?.code === "wallet_rejected") return error.message;
  if (error?.status === 400 && error.message === "Do not send a recovery secret.") return error.message;
  if (error?.status === 401) return "The wallet or recovery check could not be verified for this lifetime ID.";
  if (error?.status === 503) return "Blockchain verification is unavailable. No transaction was sent.";
  if (error?.status === 429) {
    return `Too many sign-in attempts for this patient. Wait ${patientRetryLabel(error.retryAfterSeconds)} and try again.`;
  }
  return "Patient sign-in could not be completed. Try again later.";
}
