const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function staffWalletState(account) {
  const clinical = account?.role === "doctor" || account?.role === "hospital_staff";
  const address = String(account?.walletAddress || "");
  if (!clinical) return { state: "not_required", label: "Not required", address: "" };
  if (ADDRESS.test(address)) return { state: "verified", label: "Wallet verified", address };
  if (account?.status === "pending") return { state: "pending", label: "Verification pending", address: "" };
  return { state: "unlinked", label: "No wallet linked", address: "" };
}

export function walletStatusTone(state) {
  if (state === "verified") return "success";
  if (state === "pending") return "warning";
  if (state === "unlinked") return "neutral";
  return "info";
}
