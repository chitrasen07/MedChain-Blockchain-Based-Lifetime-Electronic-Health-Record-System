export function claimStatusBody({ patientId, walletAddress, claimCommitment }) {
  return { patientId, walletAddress, claimCommitment };
}

export function patientAuthMessage(error) {
  if (error?.code === "wallet_missing" || error?.code === "wallet_rejected") return error.message;
  if (error?.status === 400 && error.message === "Do not send a recovery secret.") return error.message;
  if (error?.status === 401) return "The wallet or recovery check could not be verified for this lifetime ID.";
  if (error?.status === 503) return "Blockchain verification is unavailable. No transaction was sent.";
  if (error?.status === 429) return "Too many attempts. Wait and try again.";
  return "Patient sign-in could not be completed. Try again later.";
}
