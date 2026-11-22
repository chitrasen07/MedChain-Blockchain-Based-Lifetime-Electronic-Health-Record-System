import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Input } from "../components/Input";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, apiClient, messageForRequest } from "../lib/api";

const FILTERS = [
  ["all", "All activity"],
  ["profile", "Profile views"],
  ["records", "Medical record access"],
  ["changes", "Record changes"],
  ["logins", "Logins"],
  ["appointments", "Appointments"],
  ["consent", "Consent and security"],
];

const OUTCOMES = {
  success: ["success", "Succeeded"],
  failure: ["warning", "Did not succeed"],
  denied: ["danger", "Denied"],
};

export function ActivityScreen({ path, title, description, crumbs, allowPatient = false }) {
  const [filter, setFilter] = useState("all");
  const [patientId, setPatientId] = useState("");
  const [appliedPatient, setAppliedPatient] = useState("");
  const [events, setEvents] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    document.title = `${title} · MedChain`;
  }, [title]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ filter, limit: "25" });
    if (appliedPatient) params.set("patientId", appliedPatient);
    apiClient.request(`${path}?${params.toString()}`).then(
      (data) => {
        if (!active) return;
        setEvents(Array.isArray(data?.events) ? data.events : []);
        setCursor(data?.nextCursor || null);
        setPhase("ready");
        setMessage("");
      },
      (error) => {
        if (!active) return;
        setEvents([]);
        setCursor(null);
        setPhase("error");
        setMessage(error instanceof ApiError ? messageForRequest(error) : "The activity history could not be loaded.");
      },
    );
    return () => {
      active = false;
    };
  }, [appliedPatient, filter, path]);

  async function loadMore() {
    if (!cursor) return;
    const params = new URLSearchParams({ filter, limit: "25", before: cursor });
    if (appliedPatient) params.set("patientId", appliedPatient);
    const data = await apiClient.request(`${path}?${params.toString()}`);
    setEvents((current) => [...current, ...(Array.isArray(data?.events) ? data.events : [])]);
    setCursor(data?.nextCursor || null);
  }

  return (
    <div>
      <PageHeader eyebrow={crumbs?.[0]?.label} title={title} description={description} crumbs={crumbs} />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([id, label]) => (
          <Button key={id} type="button" size="sm" variant={filter === id ? "primary" : "secondary"} onClick={() => setFilter(id)}>
            {label}
          </Button>
        ))}
      </div>
      {allowPatient ? (
        <Card className="mb-4" title="Authorized patient" description="Activity for a patient is shown only while your clinical access is current.">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); setAppliedPatient(patientId.trim()); }}>
            <Input className="sm:flex-1" label="Lifetime Patient ID" value={patientId} onChange={(event) => setPatientId(event.target.value)} placeholder="PATIENT-000001" />
            <Button type="submit">Show patient activity</Button>
            {appliedPatient ? <Button type="button" variant="secondary" onClick={() => { setPatientId(""); setAppliedPatient(""); }}>My activity</Button> : null}
          </form>
        </Card>
      ) : null}
      {phase === "loading" ? <LoadingSkeleton label="Loading activity" /> : null}
      {phase === "error" ? <ErrorState title="Activity unavailable" message={message} /> : null}
      {phase === "ready" && events.length === 0 ? (
        <Card>
          <EmptyState title="No activity recorded" description="Events appear here after a real sign-in, profile view, record change, appointment action, or consent change. Older actions that were never logged are not invented." />
        </Card>
      ) : null}
      {phase === "ready" && events.length > 0 ? (
        <Card title="Activity">
          <ol className="space-y-4">
            {events.map((event) => {
              const outcome = OUTCOMES[event.outcome] || OUTCOMES.success;
              return (
                <li key={event.id} className="border-b border-line pb-4 last:border-0">
                  <p className="text-sm font-medium text-navy">{event.summary}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge tone={outcome[0]}>{outcome[1]}</StatusBadge>
                    <span className="text-xs text-muted">{event.actorRole || "Role unavailable"} · {event.category} · {event.displayTime}</span>
                  </div>
                  {event.patientId ? <p className="mt-1 text-xs text-muted">Patient {event.patientId}</p> : null}
                  {event.transaction ? <p className="mt-1 break-all text-xs text-muted">Transaction {event.transaction}</p> : null}
                </li>
              );
            })}
          </ol>
          {cursor ? <Button className="mt-4" type="button" variant="secondary" onClick={loadMore}>Load earlier activity</Button> : null}
        </Card>
      ) : null}
    </div>
  );
}
