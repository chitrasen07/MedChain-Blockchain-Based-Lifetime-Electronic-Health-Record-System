import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { ApiError, apiClient } from "../lib/api";
import {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_PATIENT_REGISTRY,
  formatClaimWait,
  loadClaimProgress,
  mergeClaimProgress,
  readClaimDelay,
  remainingClaimSeconds,
  saveClaimProgress,
  sendInstantClaim,
  sendPatientClaim,
  waitForReceipt,
} from "../lib/claimChain";
import { claimCommitmentForRecoveryCode, sealedClaimForRecoveryCode, sepoliaTransactionUrl } from "../lib/ownership";
import { claimStatusBody, patientAuthMessage } from "../services/patientPortal";

function walletMessage(error) {
  if (error?.code === 4001) return "MetaMask did not approve the request. Nothing was sent.";
  return error?.message || "The claim was not sent.";
}

export function OwnershipClaimPanel({ patientId, walletAddress, onLinked }) {
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
  const [claim, setClaim] = useState(null);

  useEffect(() => {
    const saved = loadClaimProgress();
    if (!saved) return;
    setSavedPatientId(saved.patientId || "");
    setPatientRef(saved.patientRef || "");
    setSealedClaim(saved.sealedClaim || "");
    setDelaySeconds(saved.delaySeconds || 0);
    setAnnouncedAt(saved.announcedAt || 0);
    setAnnounceTx(saved.announceTx || "");
    if (saved.onChainClaim) setClaim({ onChainClaim: saved.onChainClaim, canAnnounce: saved.onChainClaim === "not_submitted", canReveal: false, message: "" });
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
    const onChain = (value) => { if (active) setChainId(Number(value)); };
    ethereum.on?.("chainChanged", onChain);
    return () => {
      active = false;
      ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [busy]);

  useEffect(() => {
    if (!announcedAt || !delaySeconds) return undefined;
    const tick = () => setRemaining(remainingClaimSeconds(announcedAt, delaySeconds));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [announcedAt, delaySeconds]);

  const onSepolia = chainId === SEPOLIA_CHAIN_ID;
  const connected = /^0x[0-9a-fA-F]{40}$/.test(walletAddress || "");
  const id = patientId.trim().toUpperCase();
  const samePatient = id === savedPatientId;
  const canAnnounce = Boolean(claim) && claim.canAnnounce === true && samePatient && Boolean(sealedClaim);
  const canReveal = Boolean(claim) && claim.canReveal === true && samePatient && remaining === 0 && /^0x[0-9a-fA-F]{64}$/.test(recoveryCode.trim());

  function applyClaim(next, code, address) {
    const merged = mergeClaimProgress(loadClaimProgress(), next);
    setClaim({ ...next, ...merged });
    setSavedPatientId(next.patientId || id);
    setPatientRef(next.patientRef || "");
    setDelaySeconds(Number(next.claimDelaySeconds) || merged.delaySeconds || 0);
    setAnnouncedAt(Number(next.announcedAt) || merged.announcedAt || 0);
    setAnnounceTx(next.announceTx || merged.announceTx || "");
    if (merged.sealedClaim || code) {
      const sealed = sealedClaimForRecoveryCode(code, address, next.patientRef || "");
      if (sealed) setSealedClaim(sealed);
    }
    saveClaimProgress({
      patientId: next.patientId || id,
      walletAddress: address,
      patientRef: next.patientRef || "",
      sealedClaim: sealedClaimForRecoveryCode(code, address, next.patientRef || "") || merged.sealedClaim || "",
      announceTx: next.announceTx || merged.announceTx || "",
      announcedAt: Number(next.announcedAt) || 0,
      delaySeconds: Number(next.claimDelaySeconds) || 0,
      onChainClaim: merged.onChainClaim || next.onChainClaim || "",
    });
    return merged;
  }

  async function readStatus(code) {
    const claimCommitment = claimCommitmentForRecoveryCode(code);
    const nextSealed = sealedClaimForRecoveryCode(code, walletAddress, patientRef);
    const result = await apiClient.request("/patient-auth/claim-status", {
      method: "POST",
      body: claimStatusBody({
        patientId: id,
        walletAddress,
        claimCommitment,
        sealedClaim: nextSealed || undefined,
      }),
      authenticated: false,
    });
    let next = result;
    const ethereum = globalThis.window?.ethereum;
    if (ethereum?.request && onSepolia && result?.claimMode !== "instant" && result?.onChainClaim !== "complete") {
      try {
        const contractDelay = await readClaimDelay(ethereum, SEPOLIA_PATIENT_REGISTRY);
        if (contractDelay) next = { ...result, claimDelaySeconds: contractDelay };
      } catch {
        next = result;
      }
    }
    return applyClaim(next, code, walletAddress);
  }

  async function useSepolia() {
    const ethereum = globalThis.window?.ethereum;
    if (!ethereum?.request) {
      setNotice("Wallet not connected. Install or open MetaMask. No transaction was sent.");
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
    if (!/^PATIENT-[0-9]{1,12}$/.test(id)) {
      setNotice("Enter a lifetime patient ID such as PATIENT-000001.");
      return;
    }
    if (!connected) {
      setNotice("Wallet not connected. Connect the MetaMask account that should own this record.");
      return;
    }
    const code = recoveryCode.trim();
    if (!claimCommitmentForRecoveryCode(code)) {
      setNotice("Enter the recovery code saved at registration. It stays in this browser and is not sent to the hospital.");
      return;
    }
    setBusy("check");
    try {
      const merged = await readStatus(code);
      setNotice(merged.message || "Recovery code valid. No transaction was sent.");
    } catch (error) {
      setNotice(error instanceof ApiError ? patientAuthMessage(error) : "The ownership check could not be completed.");
    } finally {
      setBusy("");
    }
  }

  async function linkNow() {
    const code = recoveryCode.trim();
    if (!window.confirm("MetaMask will ask you to sign the wallet link, then approve one transaction. The recovery code is published in that transaction. Continue only if you approve that.")) return;
    setBusy("link");
    setNotice("Awaiting MetaMask confirmation.");
    try {
      const current = await readStatus(code);
      if (current.claimMode !== "instant" || !current.typedData) {
        setNotice(current.message || "This record cannot be linked immediately.");
        return;
      }
      const ethereum = globalThis.window.ethereum;
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      if (String(accounts?.[0] || "").toLowerCase() !== walletAddress.toLowerCase()) {
        setNotice("Connect the patient's own wallet. No transaction was sent.");
        return;
      }
      const signature = await ethereum.request({
        method: "eth_signTypedData_v4",
        params: [accounts[0], JSON.stringify(current.typedData)],
      });
      const hash = await sendInstantClaim({
        patientRef: current.patientRef,
        secret: code,
        signature,
        registryAddress: current.registryAddress,
        chainId: SEPOLIA_CHAIN_ID,
        ethereum,
        from: walletAddress,
      });
      setNotice("Transaction pending. Waiting for Sepolia confirmation. Do not send another link.");
      const receipt = await waitForReceipt(ethereum, hash, { attempts: 40 });
      if (!receipt) {
        setNotice("Transaction pending. The wallet link was submitted. Check again after Sepolia confirms it. Do not create another Patient ID.");
        return;
      }
      if (receipt.status === "0x0") {
        setNotice("The wallet link reverted. Sign-in stays unavailable. Check the wallet, network, and recovery code.");
        return;
      }
      setRecoveryCode("");
      const ownership = await apiClient.request("/patient-auth/ownership-status", {
        method: "POST",
        body: { patientId: id, walletAddress },
        authenticated: false,
      });
      if (ownership?.walletIsController) {
        setClaim({ onChainClaim: "complete", claimMode: "linked", canAnnounce: false, canReveal: false, message: ownership.message });
        setNotice("Wallet linked successfully. This patient can sign in with this wallet.");
        onLinked?.(ownership);
      } else {
        setNotice(ownership?.message || "The link was confirmed. Check wallet status, then sign in with this wallet.");
      }
    } catch (error) {
      setNotice(error instanceof ApiError ? patientAuthMessage(error) : walletMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function announce() {
    const code = recoveryCode.trim();
    if (!window.confirm("MetaMask will ask you to approve the ownership announcement. The recovery code is not included. Do not announce again after one is confirmed.")) return;
    setBusy("announce");
    setNotice("Awaiting MetaMask confirmation.");
    try {
      const current = await readStatus(code);
      if (current.canAnnounce !== true) {
        setNotice(current.message || "An announce transaction is already recorded. Do not send another one.");
        return;
      }
      const hash = await sendPatientClaim({
        kind: "announce",
        patientRef: current.patientRef || patientRef,
        value: sealedClaimForRecoveryCode(code, walletAddress, current.patientRef || patientRef),
        chainId: SEPOLIA_CHAIN_ID,
        ethereum: globalThis.window.ethereum,
      });
      setAnnounceTx(hash);
      saveClaimProgress({
        patientId: id,
        walletAddress,
        patientRef,
        sealedClaim,
        announceTx: hash,
        announcedAt: 0,
        delaySeconds,
        onChainClaim: "pending",
      });
      setNotice("Transaction pending. Waiting for Sepolia confirmation. Do not send another announce.");
      const receipt = await waitForReceipt(globalThis.window.ethereum, hash, { attempts: 40 });
      if (!receipt) {
        setNotice("Transaction pending. The announce was submitted. Check the recovery code again after Sepolia confirms it. Do not send another announce.");
        return;
      }
      if (receipt.status === "0x0") {
        setNotice("The announce transaction reverted. Nothing was claimed. You can announce again.");
        return;
      }
      const merged = await readStatus(code);
      setNotice(merged.message || "Announce confirmed.");
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
    setNotice("Awaiting MetaMask confirmation.");
    try {
      const current = await readStatus(code);
      if (current.canReveal !== true) {
        setNotice(current.message || "Reveal is not available yet.");
        return;
      }
      const hash = await sendPatientClaim({
        kind: "reveal",
        patientRef: current.patientRef || patientRef,
        value: code,
        chainId: SEPOLIA_CHAIN_ID,
        ethereum: globalThis.window.ethereum,
      });
      setRevealTx(hash);
      setNotice("Transaction pending. Waiting for the reveal to confirm.");
      const receipt = await waitForReceipt(globalThis.window.ethereum, hash, { attempts: 40 });
      if (!receipt) {
        setNotice("Transaction pending. The reveal was submitted. Check wallet status again after Sepolia confirms it. Do not register a new Patient ID.");
        return;
      }
      if (receipt.status === "0x0") {
        setNotice("The reveal transaction reverted. Sign-in stays unavailable. Check the wallet, network, and recovery code, then try reveal again.");
        return;
      }
      setRecoveryCode("");
      const ownership = await apiClient.request("/patient-auth/ownership-status", {
        method: "POST",
        body: { patientId: id, walletAddress },
        authenticated: false,
      });
      if (ownership?.walletIsController) {
        setClaim({ onChainClaim: "complete", canAnnounce: false, canReveal: false, message: ownership.message });
        setNotice("Reveal confirmed. Wallet linked successfully. This patient can sign in with this wallet.");
        onLinked?.(ownership);
      } else {
        setNotice(ownership?.message || "The reveal was confirmed. Check wallet status, then sign in with this wallet.");
      }
    } catch (error) {
      setNotice(error instanceof ApiError ? patientAuthMessage(error) : walletMessage(error));
    } finally {
      setBusy("");
    }
  }

  const instant = claim?.claimMode === "instant";
  const canLink = instant && claim?.canLink === true && onSepolia && /^0x[0-9a-fA-F]{64}$/.test(recoveryCode.trim());
  const announceUrl = sepoliaTransactionUrl(announceTx);
  const revealUrl = sepoliaTransactionUrl(revealTx);
  const statusLine = !connected
    ? "Wallet not connected."
    : chainId != null && !onSepolia
      ? "Wrong network. Switch MetaMask to Sepolia."
      : claim?.onChainClaim === "announced" && remaining > 0
        ? `Waiting period remaining ${formatClaimWait(remaining)}. Do not announce again.`
        : claim?.onChainClaim === "ready"
          ? "Ready to reveal."
          : "";

  return (
    <form className="rounded-xl border border-line bg-surface px-5 py-6 sm:px-7" onSubmit={checkRecovery} noValidate>
      <h2 className="text-base font-semibold text-navy">Link a wallet to a record created without one</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        Use the same lifetime Patient ID. Do not register again. {instant
          ? "This record can be linked immediately. One MetaMask approval binds this wallet."
          : "A record still on the original registry keeps the one-hour announce and reveal wait. This page does not hide that wait."}
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-muted">
        <li>On this computer, connect the patient's own MetaMask account on Sepolia.</li>
        <li>Enter the Patient ID and recovery code. The code stays in this browser until the link is sent.</li>
        {instant
          ? <li>Approve the wallet link, then sign in with this wallet.</li>
          : <li>If this record is still on the original registry, announce once, wait for the contract period, then reveal.</li>}
      </ol>
      <div className="mt-4 space-y-4">
        <Input
          label="Recovery code"
          type="password"
          name="recoveryCode"
          autoComplete="off"
          value={recoveryCode}
          onChange={(event) => setRecoveryCode(event.target.value)}
          hint="Required again on another computer or after a browser restart. It is not stored by the hospital."
        />
        <p className="text-sm leading-6 text-muted">
          {connected ? `Connected account ${walletAddress}. ` : "Wallet not connected. "}
          {onSepolia ? "Network: Sepolia." : "Network: not Sepolia."}
          {delaySeconds ? ` Contract wait: ${formatClaimWait(delaySeconds)}.` : ""}
        </p>
        {statusLine ? <p className="text-sm leading-6 text-ink" aria-live="polite">{statusLine}</p> : null}
        {notice ? <p role="status" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
        {announceUrl ? <a className="block text-sm font-medium text-teal hover:text-teal-dark" href={announceUrl} target="_blank" rel="noreferrer">Announcement on Etherscan</a> : null}
        {revealUrl ? <a className="block text-sm font-medium text-teal hover:text-teal-dark" href={revealUrl} target="_blank" rel="noreferrer">Reveal on Etherscan</a> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" variant="secondary" onClick={useSepolia} loading={busy === "network"} disabled={Boolean(busy) || onSepolia}>Use Sepolia</Button>
          <Button type="submit" variant="secondary" loading={busy === "check"} disabled={Boolean(busy)}>Check recovery code</Button>
          {instant ? <Button type="button" onClick={linkNow} loading={busy === "link"} disabled={Boolean(busy) || !canLink}>Verify and link wallet</Button> : null}
          {instant ? null : <Button type="button" variant="secondary" onClick={announce} loading={busy === "announce"} disabled={Boolean(busy) || !onSepolia || !canAnnounce}>Announce ownership claim</Button>}
          {instant ? null : <Button type="button" onClick={reveal} loading={busy === "reveal"} disabled={Boolean(busy) || !onSepolia || !canReveal}>Reveal ownership claim</Button>}
        </div>
      </div>
    </form>
  );
}
