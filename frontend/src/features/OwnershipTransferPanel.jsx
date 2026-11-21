import { useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { SEPOLIA_CHAIN_ID, sendPatientClaim } from "../lib/claimChain";
import { ensurePatientSepolia } from "../lib/patientWallet";

export function OwnershipTransferPanel({ mode, patientRef, walletAddress }) {
  const [nextWallet, setNextWallet] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const propose = mode === "propose";

  async function submit() {
    if (busy) return;
    if (!/^0x[0-9a-fA-F]{64}$/.test(patientRef || "")) {
      setNotice("The blockchain reference is not available. No transaction was sent.");
      return;
    }
    if (propose && !/^0x[0-9a-fA-F]{40}$/.test(nextWallet.trim())) {
      setNotice("Enter the patient's own wallet address. Do not enter a hospital wallet.");
      return;
    }
    const approved = window.confirm(propose
      ? "MetaMask will ask the current controller to propose a transfer. The patient must accept it before ownership changes."
      : "MetaMask will ask this wallet to accept the proposed transfer. Nothing changes until you approve it.");
    if (!approved) return;
    setBusy(true);
    setNotice("");
    try {
      await ensurePatientSepolia();
      const hash = await sendPatientClaim({
        kind: propose ? "propose" : "accept",
        patientRef,
        value: propose ? nextWallet.trim() : "0x",
        chainId: SEPOLIA_CHAIN_ID,
        ethereum: globalThis.window.ethereum,
      });
      setNotice(propose
        ? `Transfer proposed. Transaction ${hash}. The patient must accept it, then sign in with the new wallet.`
        : `Transfer acceptance submitted. Transaction ${hash}. After confirmation, sign in with this wallet.`);
    } catch (error) {
      const rejected = error?.code === 4001 || error?.code === "wallet_rejected";
      setNotice(rejected ? "MetaMask did not approve the request. Nothing was sent." : error?.message || "The transfer was not sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-line bg-canvas px-3 py-3">
      <p className="text-sm font-medium text-navy">{propose ? "Propose a patient-wallet transfer" : "Accept an ownership transfer"}</p>
      <p className="mt-1 text-sm leading-6 text-muted">
        {propose
          ? "This record is controlled by the connected hospital wallet. The server cannot reassign it. Propose the patient's own wallet, then ask the patient to accept on the sign-in page."
          : "If the current controller has proposed this wallet, accept the transfer here. A new Patient ID is not required."}
      </p>
      {walletAddress ? <p className="mt-2 break-all text-xs text-muted">Connected wallet {walletAddress}</p> : null}
      {propose ? (
        <Input className="mt-3" label="Patient wallet" name="nextWallet" value={nextWallet} onChange={(event) => setNextWallet(event.target.value)} placeholder="0x" />
      ) : null}
      {notice ? <p role="status" className="mt-3 text-sm leading-6 text-ink">{notice}</p> : null}
      <Button className="mt-3" type="button" variant="secondary" loading={busy} disabled={busy} onClick={submit}>
        {propose ? "Propose transfer" : "Accept transfer"}
      </Button>
    </div>
  );
}
