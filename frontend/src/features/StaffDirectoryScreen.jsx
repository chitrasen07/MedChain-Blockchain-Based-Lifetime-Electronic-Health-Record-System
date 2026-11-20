import { useEffect, useState } from "react";
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
  return error instanceof ApiError ? messageForRequest(error) : error?.code === 4001
    ? "MetaMask did not approve the request. Nothing was sent."
    : error?.message || "The hospital service could not complete the request.";
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

const emptyAccount = { fullName: "", email: "", password: "", role: "receptionist", chainRole: "NURSE" };

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
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [target, setTarget] = useState(null);
  const [disabling, setDisabling] = useState(false);
  const [roleTarget, setRoleTarget] = useState(null);
  const [nextRole, setNextRole] = useState("receptionist");
  const [nextChainRole, setNextChainRole] = useState("NURSE");

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  async function load() {
    setLoadError("");
    try {
      const result = await adminService.listUsers();
      setUsers(Array.isArray(result?.users) ? result.users : []);
    } catch (error) {
      setUsers([]);
      setLoadError(requestMessage(error));
    }
  }

  useEffect(() => {
    let active = true;
    adminService.listUsers().then((result) => {
      if (active) setUsers(Array.isArray(result?.users) ? result.users : []);
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

  async function finishChainAction(member, kind, roleName, wallet) {
    if (!window.confirm("Switch MetaMask to the hospital administrator wallet. The role transaction is sent only after you approve it there.")) return;
    setBusy("chain");
    setNotice("Waiting for the hospital administrator to approve the transaction in MetaMask.");
    try {
      await globalThis.window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
      const hash = await sendRoleTransaction({
        kind,
        chainId: SEPOLIA_CHAIN_ID,
        roleName,
        account: wallet,
        ethereum: globalThis.window.ethereum,
      });
      const receipt = await waitForReceipt(globalThis.window.ethereum, hash);
      if (!receipt || receipt.status === "0x0") {
        await adminService.markAuthorizationFailed(member.id, hash);
        setNotice("The role transaction was not confirmed.");
        return;
      }
      const verified = await adminService.verifyAuthorization(member.id);
      setNotice(verified.verified
        ? "The blockchain role matches this staff account."
        : "The transaction was confirmed, but the role is not correct yet. Retry the authorization.");
    } catch (error) {
      if (error?.code !== 4001) await adminService.markAuthorizationFailed(member.id).catch(() => {});
      setNotice(requestMessage(error));
    } finally {
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
      setCreated(`${result.fullName || result.email} was created as ${roleLabel(result.role)}.`);
      setAccount(emptyAccount);
      setStaffWallet("");
      setWalletProof(null);
      if (result.authorization?.status === "pending") {
        await finishChainAction(result, "grant", result.authorization.chainRole, result.authorization.walletAddress);
      }
      await load();
    } catch (error) {
      setNotice(requestMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function retryAuthorization(accountRow) {
    setNotice("");
    if (!accountRow.walletAddress || !accountRow.chainRole) {
      await linkExisting(accountRow);
      return;
    }
    await adminService.saveAuthorization(accountRow.id, { chainRole: accountRow.chainRole });
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
      status: accountRow.status,
      authorization: <StatusBadge tone={authorizationTone(label)}>{label}</StatusBadge>,
      wallet: accountRow.walletAddress || "No wallet linked",
      transaction: explorer ? <a className="text-teal" href={explorer} target="_blank" rel="noreferrer">View</a> : "",
      action: (
        <div className="flex flex-col gap-2">
          {accountRow.status === "active" && accountRow.id !== user?.id ? (
            <Button size="sm" variant="danger" onClick={() => setTarget(accountRow)}>Disable</Button>
          ) : accountRow.id === user?.id ? "Signed-in account" : "Disabled"}
          {accountRow.id !== user?.id && (label === "Pending" || label === "Failed") ? (
            <Button size="sm" variant="secondary" onClick={() => accountRow.walletAddress ? retryAuthorization(accountRow) : linkExisting(accountRow)} disabled={Boolean(busy)}>
              {accountRow.walletAddress ? "Retry authorization" : "Link wallet"}
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
              { key: "status", header: "Account" },
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
      <form className="mt-4" onSubmit={onCreate} noValidate>
        <Card title="Add a staff member" description="Clinical staff sign with their own wallet. Receptionists and reviewers do not need one. The hospital administrator approves the Sepolia role separately, and the hospital signing key is not used.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Name" name="fullName" value={account.fullName} error={errors.fullName} autoComplete="name" onChange={(event) => setAccount((current) => ({ ...current, fullName: event.target.value }))} />
            <Input label="Work email" name="email" type="email" value={account.email} error={errors.email} autoComplete="off" onChange={(event) => setAccount((current) => ({ ...current, email: event.target.value }))} />
            <Input label="Password" name="password" type="password" value={account.password} error={errors.password} hint="At least 12 characters." autoComplete="new-password" onChange={(event) => setAccount((current) => ({ ...current, password: event.target.value }))} />
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
          {clinicalRole(account.role) ? (
            <div className="mt-4">
              <p className="break-all text-sm text-ink">{staffWallet || "No staff wallet connected."}</p>
              {errors.walletAddress ? <p className="mt-1 text-xs text-danger">{errors.walletAddress}</p> : null}
              {errors.walletProof ? <p className="mt-1 text-xs text-danger">{errors.walletProof}</p> : null}
              <Button className="mt-3" type="button" variant="secondary" onClick={() => signWallet(account)} loading={busy === "sign"} disabled={Boolean(busy) || creating}>Sign staff wallet</Button>
            </div>
          ) : null}
          {notice ? <p role="alert" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
          {created ? <p role="status" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{created}</p> : null}
          <Button className="mt-4" type="submit" loading={creating} disabled={creating || Boolean(busy)}>Create account</Button>
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
