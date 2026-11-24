import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { DataTable } from "../components/DataTable";
import { ErrorState } from "../components/ErrorState";
import { Input } from "../components/Input";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/useAuth";
import { ApiError, messageForRequest } from "../lib/api";
import { SEPOLIA_CHAIN_ID } from "../lib/claimChain";
import { waitForReceipt } from "../lib/claimChain";
import { pageChrome } from "../lib/pageChrome";
import { sepoliaTransactionUrl } from "../lib/ownership";
import { connectPatientWallet, signPatientLogin } from "../lib/patientWallet";
import { roleLabel } from "../lib/roles";
import { sendRoleTransaction } from "../lib/roleChain";
import { HOSPITAL_STAFF_CHAIN_ROLES, STAFF_CREATE_ROLES, adminService, clinicalRole, validateStaffAccount } from "../services/adminService";

function requestMessage(error) {
  if (error?.code === 4001) return "MetaMask rejected the transaction. No new role transaction was sent.";
  if (error?.code === "wrong_account") return error.message;
  if (error instanceof ApiError) return messageForRequest(error);
  if (/network|timeout|fetch|disconnected/i.test(error?.message || "")) return "Sepolia did not respond. The authorization was not changed.";
  if (/insufficient|permission|unauthorized/i.test(error?.message || "")) return "The connected wallet cannot assign this role. Use the hospital administrator account.";
  return error?.message || "The hospital service could not complete the request.";
}

function reverted(status) {
  try { return BigInt(status) === 0n; } catch { return status === "0x0"; }
}

function authorizationLabel(accountRow) {
  if (!clinicalRole(accountRow.role) && accountRow.authorizationAction !== "revoke") return "Not required";
  if (accountRow.authorizationStatus === "active" && accountRow.authorizationAction !== "revoke") return "Active";
  if (accountRow.authorizationStatus === "failed") return "Failed";
  return "Pending";
}

function authorizationTone(label) {
  if (label === "Active") return "success";
  if (label === "Failed") return "danger";
  if (label === "Pending") return "warning";
  return "info";
}

const emptyAccount = { fullName: "", email: "", password: "", role: "receptionist", chainRole: "NURSE", linkWallet: "later" };

function accountLabel(status) {
  if (status === "pending") return "Activation pending";
  if (status === "disabled") return "Disabled";
  return "Active";
}

function profileLabel(accountRow) {
  if (accountRow.role !== "doctor") return "Not applicable";
  if (accountRow.profileStatus === "verified") return "Verified";
  if (accountRow.profileStatus === "pending") return "Pending verification";
  if (accountRow.profileStatus === "changes_requested") return "Changes requested";
  return "Incomplete";
}

function walletLabel(accountRow) {
  if (!clinicalRole(accountRow.role)) return "Not required";
  if (!accountRow.walletAddress) return "Verification pending";
  const address = accountRow.walletAddress;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function StaffDirectoryScreen({ pageKey }) {
  const { page, crumbs } = pageChrome(pageKey);
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [account, setAccount] = useState(emptyAccount);
  const [staffWallet, setStaffWallet] = useState("");
  const [walletProof, setWalletProof] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [created, setCreated] = useState("");
  const [issuedCode, setIssuedCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [profileView, setProfileView] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [target, setTarget] = useState(null);
  const [disabling, setDisabling] = useState(false);
  const [roleTarget, setRoleTarget] = useState(null);
  const [nextRole, setNextRole] = useState("receptionist");
  const [nextChainRole, setNextChainRole] = useState("NURSE");
  const chainLock = useRef(false);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  function showDirectory({ list, synced, chainUnavailable }) {
    setUsers(list);
    if (chainUnavailable) setNotice("Sepolia could not be checked. Staff accounts are unchanged.");
    else if (synced) setNotice("The blockchain role is already active. No new transaction was sent.");
  }

  async function listAndSync() {
    const result = await adminService.listUsers();
    let list = Array.isArray(result?.users) ? result.users : [];
    const pending = list.filter((row) => row.authorizationStatus === "pending" && row.walletAddress && row.chainRole);
    let synced = false;
    let chainUnavailable = false;
    for (const row of pending) {
      try {
        const verified = await adminService.verifyAuthorization(row.id);
        if (verified?.verified) synced = true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 503) {
          chainUnavailable = true;
          continue;
        }
        throw error;
      }
    }
    if (synced) {
      const again = await adminService.listUsers();
      list = Array.isArray(again?.users) ? again.users : list;
    }
    return { list, synced, chainUnavailable };
  }

  async function load() {
    setLoadError("");
    try {
      showDirectory(await listAndSync());
    } catch (error) {
      setUsers([]);
      setLoadError(requestMessage(error));
    }
  }

  useEffect(() => {
    let active = true;
    listAndSync().then((result) => {
      if (!active) return;
      showDirectory(result);
    }).catch((error) => {
      if (!active) return;
      setUsers([]);
      setLoadError(requestMessage(error));
    });
    return () => {
      active = false;
    };
  }, []);

  async function signWallet(source) {
    setBusy("sign");
    setNotice("");
    try {
      const address = await connectPatientWallet();
      const chainRole = source.role === "doctor" ? "DOCTOR" : source.chainRole;
      const challenge = await adminService.walletChallenge({
        fullName: source.fullName.trim(),
        email: source.email.trim(),
        role: source.role,
        chainRole,
        walletAddress: address,
      });
      const signature = await signPatientLogin(challenge.message, address);
      setStaffWallet(address);
      setWalletProof({ nonce: challenge.nonce, signature });
      setNotice("The staff wallet signed the link. No role transaction has been sent.");
      return { walletAddress: address, walletProof: { nonce: challenge.nonce, signature } };
    } catch (error) {
      setWalletProof(null);
      setNotice(requestMessage(error));
      return null;
    } finally {
      setBusy("");
    }
  }

  async function alreadyActive(member) {
    const verified = await adminService.verifyAuthorization(member.id);
    if (!verified?.verified) return false;
    setNotice("The blockchain role is already active. No new transaction was sent.");
    return true;
  }

  async function finishChainAction(member, kind, roleName, wallet) {
    if (chainLock.current) return;
    chainLock.current = true;
    setBusy("chain");
    setNotice("");
    try {
      if (await alreadyActive(member)) return;
      const ethereum = globalThis.window?.ethereum;
      if (!ethereum?.request) {
        setNotice("A wallet extension is required. No transaction was sent.");
        return;
      }
      if (member.authorizationTx) {
        const existing = await ethereum.request({ method: "eth_getTransactionReceipt", params: [member.authorizationTx] });
        if (!existing) {
          setNotice("A role transaction is already pending on Sepolia. Wait for confirmation before sending another.");
          return;
        }
      }
      if (!window.confirm("Switch MetaMask to the hospital administrator wallet. The role transaction is sent only after you approve it there.")) {
        setNotice("The role transaction was not sent.");
        return;
      }
      const current = Number(await ethereum.request({ method: "eth_chainId" }));
      if (current !== SEPOLIA_CHAIN_ID) {
        await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
      }
      setNotice("Waiting for the hospital administrator to approve the transaction in MetaMask.");
      const hash = await sendRoleTransaction({
        kind,
        chainId: SEPOLIA_CHAIN_ID,
        roleName,
        account: wallet,
        ethereum,
      });
      await adminService.recordAuthorization(member.id, hash);
      const receipt = await waitForReceipt(ethereum, hash);
      if (!receipt) {
        setNotice("The role transaction is still pending on Sepolia. Wait for confirmation before sending another.");
        return;
      }
      if (reverted(receipt.status)) {
        if (await alreadyActive(member)) return;
        await adminService.markAuthorizationFailed(member.id, hash);
        setNotice("The role transaction reverted. The hospital administrator account must approve it.");
        return;
      }
      const verified = await adminService.verifyAuthorization(member.id);
      setNotice(verified.verified
        ? "The blockchain role matches this staff account."
        : "The transaction was confirmed, but the role is not correct yet. Retry after the network updates.");
    } catch (error) {
      if (![4001, "wrong_account"].includes(error?.code)) {
        const verified = await adminService.verifyAuthorization(member.id).catch(() => null);
        if (verified?.verified) {
          setNotice("The blockchain role is already active. No new transaction was sent.");
          return;
        }
      }
      if (error?.code !== 4001 && error?.code !== "wrong_account") {
        await adminService.markAuthorizationFailed(member.id).catch(() => {});
      }
      setNotice(requestMessage(error));
    } finally {
      chainLock.current = false;
      setBusy("");
      await load();
    }
  }

  async function onCreate(event) {
    event.preventDefault();
    const parsed = validateStaffAccount({ ...account, walletAddress: staffWallet, walletProof });
    setErrors(parsed.errors);
    setCreated("");
    if (Object.keys(parsed.errors).length) return;
    setCreating(true);
    setNotice("");
    try {
      const result = await adminService.createUser(parsed.body);
      setAccount(emptyAccount);
      setStaffWallet("");
      setWalletProof(null);
      if (result.activationCode) {
        setIssuedCode({
          name: result.fullName || result.email,
          code: result.activationCode,
          expiresAt: result.activationExpiresAt,
        });
        setCopied(false);
        setCreated(`${result.fullName || result.email} is waiting for activation. Share the code once, then leave this page.`);
      } else {
        setIssuedCode(null);
        setCreated(`${result.fullName || result.email} was created as ${roleLabel(result.role)}.`);
        if (result.authorization?.status === "pending") {
          await finishChainAction(result, "grant", result.authorization.chainRole, result.authorization.walletAddress);
        }
      }
      await load();
    } catch (error) {
      setNotice(requestMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function retryAuthorization(accountRow) {
    if (chainLock.current) return;
    setNotice("");
    if (!accountRow.walletAddress || !accountRow.chainRole) {
      await linkExisting(accountRow);
      return;
    }
    try {
      if (await alreadyActive(accountRow)) {
        await load();
        return;
      }
    } catch (error) {
      setNotice(requestMessage(error));
      return;
    }
    const kind = accountRow.authorizationAction === "revoke" ? "revoke" : "grant";
    await finishChainAction(accountRow, kind, accountRow.chainRole, accountRow.walletAddress);
  }

  async function linkExisting(accountRow) {
    const fullName = accountRow.fullName || window.prompt("Enter the staff member's name.") || "";
    if (fullName.trim().length < 2) {
      setNotice("Enter the staff member's name.");
      return;
    }
    const chainRole = accountRow.role === "doctor" ? "DOCTOR" : (accountRow.chainRole || nextChainRole);
    const signed = await signWallet({
      fullName: fullName.trim(),
      email: accountRow.email,
      role: accountRow.role,
      chainRole,
    });
    if (!signed) return;
    const saved = await adminService.saveAuthorization(accountRow.id, { fullName: fullName.trim(), chainRole, walletProof: signed.walletProof });
    await finishChainAction(accountRow, "grant", saved.authorization.chainRole, saved.authorization.walletAddress);
  }

  async function openProfile(accountRow) {
    setNotice("");
    setReviewNote("");
    try {
      setProfileView(await adminService.doctorProfile(accountRow.id));
    } catch (error) {
      setNotice(requestMessage(error));
    }
  }

  async function reviewProfile(decision) {
    if (!profileView) return;
    setBusy("profile");
    setNotice("");
    try {
      const saved = await adminService.reviewDoctorProfile(profileView.id, { decision, note: reviewNote });
      setProfileView(saved);
      setNotice(decision === "verified" ? "The professional credentials were approved." : "The doctor was asked to update the credentials.");
      await load();
    } catch (error) {
      setNotice(requestMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function copyIssuedCode() {
    if (!issuedCode?.code) return;
    try {
      await navigator.clipboard.writeText(issuedCode.code);
      setCopied(true);
    } catch {
      setCopied(false);
      setNotice("Select the activation code and copy it manually. It is not stored again.");
    }
  }

  async function regenerateCode(accountRow) {
    setBusy("code");
    setNotice("");
    try {
      const issued = await adminService.reissueActivation(accountRow.id);
      setIssuedCode({
        name: accountRow.fullName || accountRow.email,
        code: issued.activationCode,
        expiresAt: issued.activationExpiresAt,
      });
      setCopied(false);
      setCreated("The previous activation code no longer works. Share the new code once.");
    } catch (error) {
      setNotice(requestMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function onDisable() {
    if (!target) return;
    setDisabling(true);
    setNotice("");
    const chainRole = target.chainRole;
    const wallet = target.walletAddress;
    try {
      await adminService.disableUser(target.id);
      setTarget(null);
      if (chainRole && wallet) await finishChainAction(target, "revoke", chainRole, wallet);
      else await load();
    } catch (error) {
      setTarget(null);
      setNotice(requestMessage(error));
    } finally {
      setDisabling(false);
    }
  }

  async function onChangeRole() {
    if (!roleTarget) return;
    setBusy("role");
    setNotice("");
    try {
      let walletProof;
      if (clinicalRole(nextRole) && (!roleTarget.walletAddress || roleTarget.role !== nextRole)) {
        const signed = await signWallet({
          fullName: roleTarget.fullName || "",
          email: roleTarget.email,
          role: nextRole,
          chainRole: nextRole === "doctor" ? "DOCTOR" : nextChainRole,
        });
        if (!signed) return;
        walletProof = signed.walletProof;
      }
      const result = await adminService.changeRole(roleTarget.id, {
        role: nextRole,
        chainRole: nextRole === "hospital_staff" ? nextChainRole : undefined,
        walletProof,
      });
      const previous = roleTarget;
      setRoleTarget(null);
      if (result.authorization?.action === "revoke") {
        await finishChainAction(previous, "revoke", previous.chainRole, previous.walletAddress);
      } else if (result.authorization?.action === "grant") {
        if (previous.chainRole && previous.chainRole !== result.authorization.chainRole && previous.walletAddress) {
          await finishChainAction(previous, "revoke", previous.chainRole, previous.walletAddress);
        }
        await finishChainAction(result, "grant", result.authorization.chainRole, result.authorization.walletAddress);
      } else {
        await load();
      }
    } catch (error) {
      setNotice(requestMessage(error));
    } finally {
      setBusy("");
    }
  }

  const rows = (users || []).map((accountRow) => {
    const label = authorizationLabel(accountRow);
    const explorer = sepoliaTransactionUrl(accountRow.authorizationTx);
    return {
      id: accountRow.id,
      name: accountRow.fullName || "Not recorded",
      email: accountRow.email,
      role: roleLabel(accountRow.role),
      specialty: accountRow.role === "doctor" ? (accountRow.specialization || "Not provided") : "",
      credentials: profileLabel(accountRow),
      status: <StatusBadge tone={accountRow.status === "active" ? "success" : accountRow.status === "pending" ? "warning" : "danger"}>{accountLabel(accountRow.status)}</StatusBadge>,
      authorization: <StatusBadge tone={authorizationTone(label)}>{label}</StatusBadge>,
      wallet: <span title={accountRow.walletAddress || undefined}>{walletLabel(accountRow)}</span>,
      transaction: explorer ? <a className="text-teal" href={explorer} target="_blank" rel="noreferrer">View</a> : "",
      action: (
        <div className="flex flex-col gap-2">
          {accountRow.status !== "disabled" && accountRow.id !== user?.id ? (
            <Button size="sm" variant="danger" onClick={() => setTarget(accountRow)}>Disable</Button>
          ) : accountRow.id === user?.id ? "Signed-in account" : "Disabled"}
          {accountRow.role === "doctor" ? (
            <Button size="sm" variant="secondary" onClick={() => openProfile(accountRow)} disabled={Boolean(busy)}>View profile</Button>
          ) : null}
          {accountRow.role === "doctor" && accountRow.profileStatus === "pending" ? (
            <Button size="sm" variant="secondary" onClick={() => openProfile(accountRow)} disabled={Boolean(busy)}>Review credentials</Button>
          ) : null}
          {accountRow.status === "pending" && accountRow.id !== user?.id ? (
            <Button size="sm" variant="secondary" onClick={() => regenerateCode(accountRow)} disabled={Boolean(busy)}>Regenerate activation code</Button>
          ) : null}
          {accountRow.status === "active" && accountRow.id !== user?.id && (label === "Pending" || label === "Failed") ? (
            <Button size="sm" variant="secondary" onClick={() => accountRow.walletAddress ? retryAuthorization(accountRow) : linkExisting(accountRow)} disabled={Boolean(busy)}>
              {accountRow.walletAddress ? "Approve blockchain role" : "Link wallet"}
            </Button>
          ) : null}
          {accountRow.id !== user?.id && accountRow.role !== "administrator" && accountRow.status === "active" ? (
            <Button size="sm" variant="secondary" onClick={() => { setRoleTarget(accountRow); setNextRole(accountRow.role); }}>Change role</Button>
          ) : null}
        </div>
      ),
    };
  });

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      <Card flush title="Hospital accounts">
        {users === null ? <div className="px-5 py-4"><LoadingSkeleton label="Loading staff accounts" /></div> : null}
        {loadError ? (
          <div className="px-5 py-4">
            <ErrorState title="Staff directory unavailable" message={loadError} action={<Button onClick={load}>Try again</Button>} />
          </div>
        ) : null}
        {users && !loadError ? (
          <DataTable
            columns={[
              { key: "name", header: "Name" },
              { key: "email", header: "Email" },
              { key: "role", header: "Role" },
              { key: "specialty", header: "Specialization" },
              { key: "credentials", header: "Credentials" },
              { key: "status", header: "Account activation" },
              { key: "authorization", header: "Blockchain authorization" },
              { key: "wallet", header: "Wallet" },
              { key: "transaction", header: "Transaction" },
              { key: "action", header: "Action" },
            ]}
            rows={rows}
            emptyTitle="No staff accounts"
            emptyDescription="This hospital has no staff accounts to show."
          />
        ) : null}
      </Card>
      {profileView ? (
        <Card className="mt-4" title={profileView.fullName || "Doctor profile"} description={`${profileView.hospitalName || "Hospital"} · ${profileLabel({ role: "doctor", profileStatus: profileView.verificationStatus })}`}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Specialization</dt><dd>{profileView.specialization || "Not provided"}</dd></div>
            <div><dt className="text-muted">Experience</dt><dd>{Number.isInteger(profileView.experienceYears) ? `${profileView.experienceYears} years` : "Not provided"}</dd></div>
            <div><dt className="text-muted">Registration</dt><dd>{profileView.registrationNumber || "Not provided"}{profileView.registrationCouncil ? ` · ${profileView.registrationCouncil}` : ""}</dd></div>
            <div><dt className="text-muted">Department</dt><dd>{profileView.department || "Not provided"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-muted">Education</dt><dd>{profileView.qualifications?.length ? profileView.qualifications.map((item) => `${item.degree}, ${item.institution}`).join("; ") : "Not provided"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-muted">Biography</dt><dd>{profileView.biography || "Not provided"}</dd></div>
          </dl>
          {profileView.verificationStatus === "pending" ? (
            <div className="mt-4 grid gap-3">
              <Input label="Note for the doctor" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={500} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" onClick={() => reviewProfile("verified")} disabled={Boolean(busy)}>Approve credentials</Button>
                <Button type="button" variant="secondary" onClick={() => reviewProfile("changes_requested")} disabled={Boolean(busy)}>Request changes</Button>
              </div>
            </div>
          ) : null}
          <Button className="mt-4" type="button" variant="secondary" onClick={() => setProfileView(null)}>Close</Button>
        </Card>
      ) : null}
      {issuedCode ? (
        <Card className="mt-4" title="Activation code" description={`Share this code with ${issuedCode.name} through a channel you trust. It is shown only once, works on another computer, and the previous code stops working if you generate a new one.`}>
          <p className="break-all font-mono text-lg tracking-wide text-navy">{issuedCode.code}</p>
          <p className="mt-2 text-sm leading-6 text-muted">Expires {issuedCode.expiresAt ? new Date(issuedCode.expiresAt).toLocaleString() : "in 24 hours"}. MedChain does not email this code.</p>
          <Button className="mt-4" type="button" variant="secondary" onClick={copyIssuedCode}>{copied ? "Copied" : "Copy"}</Button>
        </Card>
      ) : null}
      <form className="mt-4" onSubmit={onCreate} noValidate>
        <Card title="Add a staff member" description="Create the account now and let the staff member activate it later, or link their wallet while they are here. Clinical access still waits for the hospital administrator's Sepolia approval.">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant={account.linkWallet === "later" ? "primary" : "secondary"} onClick={() => { setAccount((current) => ({ ...current, linkWallet: "later" })); setWalletProof(null); }}>
              Link wallet later
            </Button>
            <Button type="button" variant={account.linkWallet === "now" ? "primary" : "secondary"} onClick={() => setAccount((current) => ({ ...current, linkWallet: "now" }))}>
              Link wallet now
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Name" name="fullName" value={account.fullName} error={errors.fullName} autoComplete="name" onChange={(event) => setAccount((current) => ({ ...current, fullName: event.target.value }))} />
            <Input label="Work email" name="email" type="email" value={account.email} error={errors.email} autoComplete="off" onChange={(event) => setAccount((current) => ({ ...current, email: event.target.value }))} />
            {account.linkWallet === "now" ? (
              <Input label="Password" name="password" type="password" value={account.password} error={errors.password} hint="At least 12 characters." autoComplete="new-password" onChange={(event) => setAccount((current) => ({ ...current, password: event.target.value }))} />
            ) : null}
            <Select label="Role" value={account.role} error={errors.role} onChange={(event) => { setAccount((current) => ({ ...current, role: event.target.value })); setWalletProof(null); }}>
              {STAFF_CREATE_ROLES.map((role) => (
                <option key={role} value={role}>{roleLabel(role)}</option>
              ))}
            </Select>
            {account.role === "hospital_staff" ? (
              <Select label="Blockchain role" value={account.chainRole} error={errors.chainRole} onChange={(event) => { setAccount((current) => ({ ...current, chainRole: event.target.value })); setWalletProof(null); }}>
                {HOSPITAL_STAFF_CHAIN_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            ) : null}
            {account.role === "doctor" ? <p className="text-sm leading-6 text-muted">The Doctor role is assigned on Sepolia after the wallet signature.</p> : null}
          </div>
          {account.linkWallet === "now" && clinicalRole(account.role) ? (
            <div className="mt-4">
              <p className="break-all text-sm text-ink">{staffWallet || "No staff wallet connected."}</p>
              {errors.walletAddress ? <p className="mt-1 text-xs text-danger">{errors.walletAddress}</p> : null}
              {errors.walletProof ? <p className="mt-1 text-xs text-danger">{errors.walletProof}</p> : null}
              <Button className="mt-3" type="button" variant="secondary" onClick={() => signWallet(account)} loading={busy === "sign"} disabled={Boolean(busy) || creating}>Sign staff wallet</Button>
            </div>
          ) : null}
          {notice ? <p role="alert" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
          {created ? <p role="status" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{created}</p> : null}
          <Button className="mt-4" type="submit" loading={creating} disabled={creating || Boolean(busy)}>{account.linkWallet === "later" ? "Create account and code" : "Create account"}</Button>
        </Card>
      </form>
      {roleTarget ? (
        <Card className="mt-4" title="Change staff role" description="A clinical change prepares the Sepolia role update. It does not create another account.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Role" value={nextRole} onChange={(event) => setNextRole(event.target.value)}>
              {STAFF_CREATE_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </Select>
            {nextRole === "hospital_staff" ? (
              <Select label="Blockchain role" value={nextChainRole} onChange={(event) => setNextChainRole(event.target.value)}>
                {HOSPITAL_STAFF_CHAIN_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            ) : null}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={onChangeRole} loading={busy === "role"} disabled={Boolean(busy)}>Save role</Button>
            <Button type="button" variant="secondary" onClick={() => setRoleTarget(null)}>Cancel</Button>
          </div>
        </Card>
      ) : null}
      <ConfirmationDialog
        open={Boolean(target)}
        title="Disable this account?"
        description={target?.chainRole ? `${target.email} will no longer pass authentication. MetaMask will then ask the hospital administrator to revoke the blockchain role.` : target ? `${target.email} will no longer pass authentication. This does not delete the account, and there is no re-enable action.` : ""}
        confirmLabel="Disable account"
        tone="danger"
        pending={disabling}
        onCancel={() => setTarget(null)}
        onConfirm={onDisable}
      />
    </div>
  );
}
