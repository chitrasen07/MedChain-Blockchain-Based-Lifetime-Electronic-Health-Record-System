import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { ApiError, apiClient } from "../lib/api";
import {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_PATIENT_REGISTRY,
  loadClaimProgress,
  readClaimDelay,
  remainingClaimSeconds,
  saveClaimProgress,
  sendPatientClaim,
  waitForReceipt,
} from "../lib/claimChain";
import { claimCommitmentForRecoveryCode, sealedClaimForRecoveryCode, sepoliaTransactionUrl } from "../lib/ownership";
import { claimStatusBody, patientAuthMessage } from "../services/patientPortal";

function formatWait(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours}h ${minutes}m ${String(rest).padStart(2, "0")}s`;
  if (minutes) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}

function walletMessage(error) {
  if (error?.code === 4001) return "MetaMask did not approve the request. Nothing was sent.";
  return error?.message || "The claim was not sent.";
}

export function OwnershipClaimPanel({ patientId, walletAddress }) {
  const [savedPatientId, setSavedPatientId] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [patientRef, setPatientRef] = useState("");
  const [sealedClaim, setSealedClaim] = useState("");
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [announcedAt, setAnnouncedAt] = useState(0);
  const [announceTx, setAnnounceTx] = useState("");
  const [revealTx, setRevealTx] = useState("");
  const [chainId, setChainId] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const saved = loadClaimProgress();
    if (!saved) return;
    setSavedPatientId(saved.patientId || "");
    setPatientRef(saved.patientRef || "");
    setSealedClaim(saved.sealedClaim || "");
    setDelaySeconds(saved.delaySeconds || 0);
    setAnnouncedAt(saved.announcedAt || 0);
    setAnnounceTx(saved.announceTx || "");
  }, []);

  useEffect(() => {
    const ethereum = globalThis.window?.ethereum;
    if (!ethereum?.request) return undefined;
    let active = true;
    ethereum.request({ method: "eth_chainId" }).then((value) => {
      if (active) setChainId(Number(value));
    }).catch(() => {
      if (active) setChainId(null);
    });
    return () => { active = false; };
  }, [busy]);

  useEffect(() => {
    if (!announcedAt || !delaySeconds) return undefined;
    const tick = () => setRemaining(remainingClaimSeconds(announcedAt, delaySeconds));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [announcedAt, delaySeconds]);

  const onSepolia = chainId === SEPOLIA_CHAIN_ID;
  const samePatient = patientId.trim().toUpperCase() === savedPatientId;
  const revealReady = samePatient && Boolean(announcedAt) && remaining === 0 && Boolean(recoveryCode.trim());

  async function useSepolia() {
    const ethereum = globalThis.window?.ethereum;
    if (!ethereum?.request) {
      setNotice("A wallet extension is required. No transaction was sent.");
      return;
    }
    setBusy("network");
    try {
      await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
      setChainId(SEPOLIA_CHAIN_ID);
      setNotice("The wallet is on Sepolia. No claim transaction was sent.");
    } catch (error) {
      setNotice(walletMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function checkRecovery(event) {
    event.preventDefault();
    setNotice("");
    const id = patientId.trim().toUpperCase();
    const code = recoveryCode.trim();
    if (!/^PATIENT-[0-9]{1,12}$/.test(id)) {
      setNotice("Enter a lifetime patient ID such as PATIENT-000001.");
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      setNotice("Connect the wallet that should become the controller.");
      return;
    }
    const claimCommitment = claimCommitmentForRecoveryCode(code);
    if (!claimCommitment) {
      setNotice("Enter the recovery code saved at registration. It stays in this browser.");
      return;
    }
    setBusy("check");
    try {
      const result = await apiClient.request("/patient-auth/claim-status", {
        method: "POST",
        body: claimStatusBody({ patientId: id, walletAddress, claimCommitment }),
        authenticated: false,
      });
      if (result?.status === "controller_set") {
        setNotice(result.message);
        return;
      }
      const nextRef = result?.patientRef || "";
      const nextSealed = sealedClaimForRecoveryCode(code, walletAddress, nextRef);
      let nextDelay = Number(result?.claimDelaySeconds) || 0;
      const ethereum = globalThis.window?.ethereum;
      if (ethereum?.request && onSepolia) {
        nextDelay = await readClaimDelay(ethereum, SEPOLIA_PATIENT_REGISTRY);
      }
      setSavedPatientId(id);
      setPatientRef(nextRef);
      setSealedClaim(nextSealed);
      setDelaySeconds(nextDelay);
      saveClaimProgress({
        patientId: id,
        walletAddress,
        patientRef: nextRef,
        sealedClaim: nextSealed,
        announceTx,
        announcedAt,
        delaySeconds: nextDelay,
      });
      setNotice(result?.message || "The recovery code matches. No transaction was sent.");
    } catch (error) {
      setNotice(error instanceof ApiError ? patientAuthMessage(error) : "The ownership check could not be completed.");
    } finally {
      setBusy("");
    }
  }

  async function announce() {
    if (!window.confirm("MetaMask will ask you to approve the ownership announcement. The recovery code is not included.")) return;
    setBusy("announce");
    setNotice("Waiting for MetaMask approval.");
    try {
      const hash = await sendPatientClaim({
        kind: "announce",
        patientRef,
        value: sealedClaim,
        chainId: SEPOLIA_CHAIN_ID,
        ethereum: globalThis.window.ethereum,
      });
      setAnnounceTx(hash);
      setNotice("Announcement submitted. Waiting for Sepolia confirmation.");
      const receipt = await waitForReceipt(globalThis.window.ethereum, hash);
      if (!receipt || receipt.status === "0x0") {
        setNotice("The announcement was not confirmed.");
        return;
      }
      setAnnouncedAt(receipt.announcedAt);
      saveClaimProgress({
        patientId: patientId.trim().toUpperCase(),
        walletAddress,
        patientRef,
        sealedClaim,
        announceTx: hash,
        announcedAt: receipt.announcedAt,
        delaySeconds,
      });
      setNotice("Announcement confirmed. Reveal stays locked until the contract waiting period ends.");
    } catch (error) {
      setNotice(walletMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function reveal() {
    const code = recoveryCode.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(code)) {
      setNotice("Enter the recovery code again. It was not saved in this browser.");
      return;
    }
    if (!window.confirm("Revealing publishes the recovery code in the public Sepolia transaction. It cannot be made secret again. Continue only if you approve that in MetaMask.")) return;
    setBusy("reveal");
    setNotice("Waiting for MetaMask approval.");
    try {
      const hash = await sendPatientClaim({
        kind: "reveal",
        patientRef,
        value: code,
        chainId: SEPOLIA_CHAIN_ID,
        ethereum: globalThis.window.ethereum,
      });
      setRevealTx(hash);
      setRecoveryCode("");
      setNotice("Reveal submitted. After it is confirmed, sign in with this wallet.");
      const receipt = await waitForReceipt(globalThis.window.ethereum, hash);
      if (!receipt || receipt.status === "0x0") {
        setNotice("The reveal was not confirmed. Sign-in stays unavailable.");
        return;
      }
      setNotice("Ownership confirmed on Sepolia. Sign in with this wallet. The recovery code was removed from this page.");
    } catch (error) {
      setNotice(walletMessage(error));
    } finally {
      setBusy("");
    }
  }

  const announceUrl = sepoliaTransactionUrl(announceTx);
  const revealUrl = sepoliaTransactionUrl(revealTx);

  return (
    <form className="rounded-xl border border-line bg-surface px-5 py-6 sm:px-7" onSubmit={checkRecovery} noValidate>
      <h2 className="text-base font-semibold text-navy">Claim a record registered without a wallet</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-muted">
        <li>Connect the wallet that should own the record.</li>
        <li>Check the recovery code. It stays in this browser and is not sent to the hospital.</li>
        <li>Announce the ownership claim on Sepolia.</li>
        <li>Wait for the contract period. The current Sepolia contract uses one hour, and the countdown below follows that contract.</li>
        <li>Reveal the claim, then sign in with this same lifetime Patient ID and wallet. Do not register a second ID.</li>
      </ol>
      <div className="mt-4 space-y-4">
        <Input
          label="Recovery code"
          type="password"
          name="recoveryCode"
          autoComplete="off"
          value={recoveryCode}
          onChange={(event) => setRecoveryCode(event.target.value)}
          hint="Required again after a refresh before reveal."
        />
        <p className="text-sm leading-6 text-muted">
          {onSepolia ? "Wallet network: Sepolia." : "Switch the wallet to Sepolia before a claim transaction."}
          {delaySeconds ? ` Contract wait: ${formatWait(delaySeconds)}.` : ""}
        </p>
        {announcedAt ? (
          <p className="text-sm leading-6 text-ink" aria-live="polite">
            {remaining > 0 ? `Reveal unlocks in ${formatWait(remaining)}.` : "The contract waiting period has ended. You can reveal."}
          </p>
        ) : null}
        {notice ? <p role="status" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
        {announceUrl ? <a className="block text-sm font-medium text-teal hover:text-teal-dark" href={announceUrl} target="_blank" rel="noreferrer">Announcement on Etherscan</a> : null}
        {revealUrl ? <a className="block text-sm font-medium text-teal hover:text-teal-dark" href={revealUrl} target="_blank" rel="noreferrer">Reveal on Etherscan</a> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" variant="secondary" onClick={useSepolia} loading={busy === "network"} disabled={Boolean(busy) || onSepolia}>Use Sepolia</Button>
          <Button type="submit" variant="secondary" loading={busy === "check"} disabled={Boolean(busy)}>Check recovery code</Button>
          <Button type="button" variant="secondary" onClick={announce} loading={busy === "announce"} disabled={Boolean(busy) || !onSepolia || !samePatient || !sealedClaim}>Announce ownership claim</Button>
          <Button type="button" onClick={reveal} loading={busy === "reveal"} disabled={Boolean(busy) || !onSepolia || !revealReady}>Reveal ownership claim</Button>
        </div>
      </div>
    </form>
  );
}
