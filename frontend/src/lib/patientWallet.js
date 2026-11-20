export async function connectPatientWallet() {
  const ethereum = globalThis.window?.ethereum;
  if (!ethereum?.request) {
    throw Object.assign(new Error("A wallet extension is required. No transaction was sent."), { code: "wallet_missing" });
  }
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  const address = Array.isArray(accounts) ? accounts[0] : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address || "")) {
    throw Object.assign(new Error("The wallet did not return an account. No transaction was sent."), { code: "wallet_missing" });
  }
  return address;
}

export async function signPatientLogin(message, address) {
  const ethereum = globalThis.window?.ethereum;
  if (!ethereum?.request) {
    throw Object.assign(new Error("A wallet extension is required. No transaction was sent."), { code: "wallet_missing" });
  }
  const signature = await ethereum.request({ method: "personal_sign", params: [message, address] });
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    throw Object.assign(new Error("The wallet did not sign the challenge. No transaction was sent."), { code: "wallet_rejected" });
  }
  return signature;
}
