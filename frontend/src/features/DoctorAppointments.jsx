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
import { HOSPITAL_ZONE_LABEL, appointmentLabel, appointmentTone, formatHospitalDate } from "../lib/appointments";
import { useAppointmentFeed } from "../lib/useAppointmentFeed";

const DURATIONS = [15, 30, 45, 60];

function ScheduleFields({ form, onChange }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Date" type="date" value={form.date} onChange={(event) => onChange({ date: event.target.value })} required />
      <Input label="Time" type="time" value={form.time} onChange={(event) => onChange({ time: event.target.value })} required />
      <label className="block text-sm font-medium text-ink">
        Duration
        <select
          className="mt-1.5 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm"
          value={form.durationMinutes}
          onChange={(event) => onChange({ durationMinutes: Number(event.target.value) })}
        >
          {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
        </select>
      </label>
      <Input label="Department" value={form.department} onChange={(event) => onChange({ department: event.target.value })} />
      <Input label="Room" value={form.room} onChange={(event) => onChange({ room: event.target.value })} />
      <Input label="Instructions for the patient" value={form.notes} onChange={(event) => onChange({ notes: event.target.value })} maxLength={500} />
    </div>
  );
}

function AppointmentRow({ appointment, onAction }) {
  return (
    <article className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-navy">{appointment.patientName || "Patient"}</h3>
          <p className="mt-1 text-sm text-muted">Lifetime Patient ID {appointment.patientId}</p>
        </div>
        <StatusBadge tone={appointmentTone(appointment.status)}>{appointmentLabel(appointment.status)}</StatusBadge>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">Requested</dt>
          <dd className="mt-1 text-sm text-ink">{appointment.requestedDate} at {appointment.requestedTime}</dd>
        </div>
        {appointment.confirmedDate ? (
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Confirmed</dt>
            <dd className="mt-1 text-sm text-ink">{appointment.confirmedDate} at {appointment.confirmedTime}{appointment.room ? ` · Room ${appointment.room}` : ""}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">Request created</dt>
          <dd className="mt-1 text-sm text-ink">{formatHospitalDate(appointment.createdAt)}</dd>
        </div>
      </dl>
      {appointment.reason ? <p className="mt-3 text-sm text-muted">Reason: {appointment.reason}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {appointment.status === "pending" ? <Button size="sm" onClick={() => onAction(appointment, "approve")}>Approve</Button> : null}
        {appointment.status === "confirmed" || appointment.status === "rescheduled" ? (
          <Button size="sm" onClick={() => onAction(appointment, "reschedule")}>Reschedule</Button>
        ) : null}
        {appointment.status === "pending" ? <Button size="sm" variant="secondary" onClick={() => onAction(appointment, "reject")}>Reject</Button> : null}
        {appointment.status === "confirmed" || appointment.status === "rescheduled" ? (
          <Button size="sm" variant="secondary" onClick={() => onAction(appointment, "complete")}>Complete</Button>
        ) : null}
        {appointment.status === "pending" || appointment.status === "confirmed" || appointment.status === "rescheduled" ? (
          <Button size="sm" variant="ghost" onClick={() => onAction(appointment, "cancel")}>Cancel</Button>
        ) : null}
      </div>
    </article>
  );
}

export function DoctorAppointmentsPage() {
  const feed = useAppointmentFeed("/doctor/appointments");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ date: "", time: "", durationMinutes: 30, department: "", room: "", notes: "", reason: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = "Appointments · MedChain";
  }, []);

  function openAction(appointment, action) {
    setSelected({ appointment, action });
    setError("");
    setMessage("");
    const useConfirmed = action === "reschedule" && appointment.confirmedDateInput;
    setForm({
      date: useConfirmed ? appointment.confirmedDateInput : appointment.requestedDateInput,
      time: useConfirmed ? appointment.confirmedTimeInput : appointment.requestedTimeInput,
      durationMinutes: appointment.durationMinutes || 30,
      department: appointment.department || "",
      room: appointment.room || "",
      notes: appointment.doctorNotes || "",
      reason: "",
    });
  }

  async function save(event) {
    event?.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    setMessage("");
    const { appointment, action } = selected;
    const path = `/doctor/appointments/${appointment.id}/${action}`;
    const body = action === "reject"
      ? { reason: form.reason }
      : action === "complete" || action === "cancel"
        ? {}
        : {
          date: form.date,
          time: form.time,
          durationMinutes: form.durationMinutes,
          department: form.department,
          room: form.room,
          notes: form.notes,
        };
    try {
      await apiClient.request(path, { method: "POST", body });
      setMessage(action === "approve" ? "The appointment is confirmed." : "The appointment was updated.");
      setSelected(null);
      feed.refresh();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? messageForRequest(requestError) : "The appointment could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  const sections = [
    ["Pending requests", feed.data?.pending || [], "No pending requests", "New requests from your patients appear here."],
    ["Today", feed.data?.today || [], "No appointments today", "Confirmed visits for today appear here."],
    ["Upcoming", feed.data?.upcoming || [], "No upcoming appointments", "Later confirmed visits appear here."],
    ["Completed", feed.data?.completed || [], "No completed appointments", "Finished visits appear here."],
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Doctor"
        title="Appointments"
        description={`Requests assigned to your verified doctor account. Confirmed times use ${HOSPITAL_ZONE_LABEL}.`}
        crumbs={[{ label: "Doctor", to: "/doctor" }, { label: "Appointments" }]}
      />
      {message ? <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p> : null}
      {error ? <p role="alert" className="mb-4 text-sm text-danger">{error}</p> : null}
      {feed.phase === "loading" ? <LoadingSkeleton label="Loading appointments" /> : null}
      {feed.phase === "error" ? <ErrorState title="Appointments unavailable" message={feed.message} action={<Button onClick={feed.refresh}>Try again</Button>} /> : null}
      {feed.phase === "ready" ? (
        <div className="grid gap-4">
          {selected ? (
            <Card title={`${selected.action[0].toUpperCase()}${selected.action.slice(1)} appointment`} description={`${selected.appointment.patientName || "Patient"} · ${selected.appointment.patientId}`}>
              <form className="grid gap-4" onSubmit={save}>
                {selected.action === "approve" || selected.action === "reschedule" ? (
                  <ScheduleFields form={form} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} />
                ) : null}
                {selected.action === "reject" ? (
                  <Input label="Rejection note" hint="Optional. The patient can read this note." value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
                ) : null}
                {selected.action === "complete" ? <p className="text-sm text-muted">Mark this visit complete. A visit reference is stored. A diagnosis is not created.</p> : null}
                {selected.action === "cancel" ? <p className="text-sm text-muted">The patient will see this appointment as cancelled.</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" loading={saving} disabled={saving}>Save</Button>
                  <Button type="button" variant="secondary" onClick={() => setSelected(null)}>Close</Button>
                </div>
              </form>
            </Card>
          ) : null}
          {sections.map(([title, items, emptyTitle, emptyDescription]) => (
            <Card key={title} title={title}>
              {items.length === 0 ? <EmptyState title={emptyTitle} description={emptyDescription} /> : (
                <div className="grid gap-3">
                  {items.map((appointment) => <AppointmentRow key={`${title}-${appointment.id}`} appointment={appointment} onAction={openAction} />)}
                </div>
              )}
            </Card>
          ))}
          <Card title="History" description="Every appointment assigned to you, including rejected and cancelled requests.">
            {(feed.data?.history || []).length === 0 ? <EmptyState title="No appointment history" description="Requests from your patients will be listed here." /> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th className="px-2 py-2 font-medium">Patient</th>
                      <th className="px-2 py-2 font-medium">Lifetime ID</th>
                      <th className="px-2 py-2 font-medium">Requested</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(feed.data?.history || []).map((appointment) => (
                      <tr key={appointment.id} className="border-t border-line">
                        <td className="px-2 py-3 text-ink">{appointment.patientName || "Patient"}</td>
                        <td className="px-2 py-3 text-ink">{appointment.patientId}</td>
                        <td className="px-2 py-3 text-ink">{appointment.requestedDate} {appointment.requestedTime}</td>
                        <td className="px-2 py-3"><StatusBadge tone={appointmentTone(appointment.status)}>{appointmentLabel(appointment.status)}</StatusBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
