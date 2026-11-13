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
import { useAuth } from "../context/useAuth";
import { ApiError, messageForRequest } from "../lib/api";
import { pageChrome } from "../lib/pageChrome";
import { roleLabel } from "../lib/roles";
import { adminService, STAFF_CREATE_ROLES, validateStaffAccount } from "../services/adminService";

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function requestMessage(error) {
  return error instanceof ApiError ? messageForRequest(error) : "The hospital service could not complete the request.";
}

export function StaffDirectoryScreen({ pageKey }) {
  const { page, crumbs } = pageChrome(pageKey);
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [account, setAccount] = useState({ email: "", password: "", role: "receptionist" });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [created, setCreated] = useState("");
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState(null);
  const [disabling, setDisabling] = useState(false);

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

  async function onCreate(event) {
    event.preventDefault();
    const parsed = validateStaffAccount(account);
    setErrors(parsed.errors);
    setCreated("");
    if (Object.keys(parsed.errors).length) return;
    setCreating(true);
    setNotice("");
    try {
      const result = await adminService.createUser(parsed.body);
      setCreated(`${result.email} was created as ${roleLabel(result.role)}.`);
      setAccount({ email: "", password: "", role: "receptionist" });
      await load();
    } catch (error) {
      setNotice(requestMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function onDisable() {
    if (!target) return;
    setDisabling(true);
    setNotice("");
    try {
      await adminService.disableUser(target.id);
      setTarget(null);
      await load();
    } catch (error) {
      setTarget(null);
      setNotice(requestMessage(error));
    } finally {
      setDisabling(false);
    }
  }

  const rows = (users || []).map((accountRow) => ({
    id: accountRow.id,
    email: accountRow.email,
    role: roleLabel(accountRow.role),
    status: accountRow.status,
    created: formatTimestamp(accountRow.createdAt),
    action: accountRow.status === "active" && accountRow.id !== user?.id ? (
      <Button size="sm" variant="danger" onClick={() => setTarget(accountRow)}>Disable</Button>
    ) : accountRow.id === user?.id ? "Signed-in account" : "Disabled",
  }));

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
              { key: "email", header: "Email" },
              { key: "role", header: "Role" },
              { key: "status", header: "Status" },
              { key: "created", header: "Created" },
              { key: "action", header: "Action" },
            ]}
            rows={rows}
            emptyTitle="No staff accounts"
            emptyDescription="This hospital has no staff accounts to show."
          />
        ) : null}
      </Card>
      <form className="mt-4" onSubmit={onCreate} noValidate>
        <Card title="Create a staff account" description="Administrator accounts are not created here. The password is sent once and is not kept in this browser.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Work email" name="email" type="email" value={account.email} error={errors.email} autoComplete="off" onChange={(event) => setAccount((current) => ({ ...current, email: event.target.value }))} />
            <Input label="Password" name="password" type="password" value={account.password} error={errors.password} hint="At least 12 characters." autoComplete="new-password" onChange={(event) => setAccount((current) => ({ ...current, password: event.target.value }))} />
            <Select label="Role" value={account.role} error={errors.role} onChange={(event) => setAccount((current) => ({ ...current, role: event.target.value }))}>
              {STAFF_CREATE_ROLES.map((role) => (
                <option key={role} value={role}>{roleLabel(role)}</option>
              ))}
            </Select>
          </div>
          {notice ? <p role="alert" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
          {created ? <p role="status" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{created}</p> : null}
          <Button className="mt-4" type="submit" loading={creating} disabled={creating}>Create account</Button>
        </Card>
      </form>
      <ConfirmationDialog
        open={Boolean(target)}
        title="Disable this account?"
        description={target ? `${target.email} will no longer pass authentication. This does not delete the account, and there is no re-enable action.` : ""}
        confirmLabel="Disable account"
        tone="danger"
        pending={disabling}
        onCancel={() => setTarget(null)}
        onConfirm={onDisable}
      />
    </div>
  );
}
