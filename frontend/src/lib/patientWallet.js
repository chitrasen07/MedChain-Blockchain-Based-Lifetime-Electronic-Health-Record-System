const SEPOLIA_CHAIN_ID = 11155111;

function walletError(message, code) {
  return Object.assign(new Error(message), { code });
}

function chainNumber(value) {
  const text = String(value ?? "").trim();
  if (text.startsWith("0x") || text.startsWith("0X")) return Number.parseInt(text, 16);
  return Number(text);
}

export async function ensurePatientSepolia() {
  const ethereum = globalThis.window?.ethereum;
  if (!ethereum?.request) {
    throw walletError("A wallet extension is required. No transaction was sent.", "wallet_missing");
  }
  const current = chainNumber(await ethereum.request({ method: "eth_chainId" }));
  if (current === SEPOLIA_CHAIN_ID) return;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  } catch (error) {
    if (error?.code === 4001) throw walletError("MetaMask did not approve the Sepolia switch. No transaction was sent.", "wallet_rejected");
    if (error?.code === 4902) throw walletError("Add the Sepolia network in MetaMask, then try again. No transaction was sent.", "wrong_network");
    throw error;
  }
  const next = chainNumber(await ethereum.request({ method: "eth_chainId" }));
  if (next !== SEPOLIA_CHAIN_ID) {
    throw walletError("Switch MetaMask to Sepolia before linking this wallet. No transaction was sent.", "wrong_network");
  }
}

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
