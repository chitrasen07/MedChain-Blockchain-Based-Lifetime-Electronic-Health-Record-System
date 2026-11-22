import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Input } from "../components/Input";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, apiClient, messageForRequest } from "../lib/api";
import { useAppointmentFeed } from "../lib/useAppointmentFeed";
import {
  HOSPITAL_ZONE_LABEL,
  appointmentLabel,
  appointmentTone,
  formatHospitalDate,
  hospitalToday,
  visitLine,
} from "../lib/appointments";

function AppointmentFacts({ appointment, confirmed = false }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">Doctor</dt>
        <dd className="mt-1 text-sm text-ink">{appointment.doctorName}</dd>
      </div>
      {appointment.specialization ? (
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">Specialization</dt>
          <dd className="mt-1 text-sm text-ink">{appointment.specialization}</dd>
        </div>
      ) : null}
      <div>
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">Hospital</dt>
        <dd className="mt-1 text-sm text-ink">{appointment.hospitalName}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">{confirmed ? "Appointment" : "Requested time"}</dt>
        <dd className="mt-1 text-sm text-ink">
          {confirmed
            ? `${appointment.confirmedDate} at ${appointment.confirmedTime}`
            : `${appointment.requestedDate} at ${appointment.requestedTime}`}
        </dd>
      </div>
      {appointment.department ? (
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">Department</dt>
          <dd className="mt-1 text-sm text-ink">{appointment.department}</dd>
        </div>
      ) : null}
      {appointment.room ? (
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">Room</dt>
          <dd className="mt-1 text-sm text-ink">{appointment.room}</dd>
        </div>
      ) : null}
      <div>
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">Status</dt>
        <dd className="mt-1"><StatusBadge tone={appointmentTone(appointment.status)}>{appointmentLabel(appointment.status)}</StatusBadge></dd>
      </div>
    </dl>
  );
}

export function UpcomingAppointmentCard() {
  const state = useAppointmentFeed("/patient-portal/appointments");
  const upcoming = state.data?.upcoming;
  if (state.phase === "loading" || state.phase === "error" || !upcoming) return null;
  const confirmed = upcoming.status === "confirmed" || upcoming.status === "rescheduled";
  const title = upcoming.status === "rescheduled" ? "Your appointment has been rescheduled." : "Your appointment has been confirmed.";
  return (
    <Card className="mb-4" title={title} description={visitLine(upcoming)}>
      <AppointmentFacts appointment={upcoming} confirmed={confirmed} />
      {upcoming.doctorNotes ? <p className="mt-4 text-sm leading-6 text-ink">Doctor instructions: {upcoming.doctorNotes}</p> : null}
      <Link className="mt-4 inline-flex text-sm font-medium text-teal hover:text-teal-dark" to="/patient/appointments">
        Open appointments
      </Link>
    </Card>
  );
}

export function PatientAppointmentsPage() {
  const feed = useAppointmentFeed("/patient-portal/appointments", { notify: true });
  const [doctors, setDoctors] = useState({ phase: "loading", items: [], message: "" });
  const [query, setQuery] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const notice = feed.notice;

  useEffect(() => {
    document.title = "Appointments · MedChain";
  }, []);

  useEffect(() => {
    let active = true;
    const path = query.trim() ? `/patient-portal/appointments/doctors?q=${encodeURIComponent(query.trim())}` : "/patient-portal/appointments/doctors";
    apiClient.request(path).then(
      (data) => {
        if (active) setDoctors({ phase: "ready", items: data.doctors, message: "" });
      },
      (error) => {
        if (!active) return;
        setDoctors({
          phase: "error",
          items: [],
          message: error instanceof ApiError ? messageForRequest(error) : "Doctors could not be loaded.",
        });
      },
    );
    return () => {
      active = false;
    };
  }, [query]);

  async function submit(event) {
    event.preventDefault();
    setFormError("");
    setSaved("");
    if (!doctorId || !date || !time) {
      setFormError("Choose a doctor, a preferred date, and a preferred time.");
      return;
    }
    setSaving(true);
    try {
      const result = await apiClient.request("/patient-portal/appointments", {
        method: "POST",
        body: { doctorId, date, time, reason },
      });
      setSaved(result.message || "The appointment request was submitted.");
      setReason("");
      setTime("");
      feed.refresh();
    } catch (error) {
      setFormError(error instanceof ApiError ? messageForRequest(error) : "The appointment request could not be submitted.");
    } finally {
      setSaving(false);
    }
  }

  async function cancel(id) {
    setFormError("");
    try {
      await apiClient.request(`/patient-portal/appointments/${id}/cancel`, { method: "POST", body: {} });
      feed.refresh();
    } catch (error) {
      setFormError(error instanceof ApiError ? messageForRequest(error) : "The appointment could not be cancelled.");
    }
  }

  const appointments = feed.data?.appointments || [];

  return (
    <div>
      <PageHeader
        eyebrow="Patient"
        title="Appointments"
        description={`Request a visit with a verified doctor. Times use ${HOSPITAL_ZONE_LABEL}. The doctor confirms when and where you should come.`}
        crumbs={[{ label: "Patient", to: "/patient" }, { label: "Appointments" }]}
      />
      {notice ? (
        <div role="status" className="mb-4 rounded-xl border border-teal/20 bg-teal/10 px-4 py-3 text-sm text-teal-dark">
          <p className="font-medium">{notice.text}</p>
          {notice.appointment ? <p className="mt-1">{visitLine(notice.appointment)}</p> : null}
        </div>
      ) : null}
      {saved ? <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{saved}</p> : null}
      {formError ? <p role="alert" className="mb-4 text-sm text-danger">{formError}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card title="Choose a doctor" description="Search by name. A specialization is shown when the hospital has recorded one.">
          <Input label="Search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Doctor name" />
          {doctors.phase === "loading" ? <LoadingSkeleton label="Loading doctors" /> : null}
          {doctors.phase === "error" ? <ErrorState title="Doctors unavailable" message={doctors.message} /> : null}
          {doctors.phase === "ready" && doctors.items.length === 0 ? (
            <EmptyState title="No doctors match" description="Try another name, or ask the hospital to verify the doctor's account." />
          ) : null}
          <div className="mt-4 grid gap-3">
            {doctors.items.map((doctor) => {
              const selected = doctor.id === doctorId;
              return (
                <button
                  key={doctor.id}
                  type="button"
                  onClick={() => setDoctorId(doctor.id)}
                  className={`rounded-xl border px-4 py-3 text-left ${selected ? "border-teal bg-teal/5" : "border-line bg-surface"}`}
                  aria-pressed={selected}
                >
                  <span className="block text-sm font-semibold text-navy">{doctor.fullName}</span>
                  <span className="mt-1 block text-sm text-muted">
                    {doctor.specialization ? `${doctor.specialization} · ` : ""}
                    {doctor.hospitalName}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {doctor.availability || "Request a preferred time. The doctor confirms the visit."}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card title="Request a visit">
          <form className="grid gap-4" onSubmit={submit}>
            <Input label="Preferred date" type="date" min={hospitalToday()} value={date} onChange={(event) => setDate(event.target.value)} required />
            <Input label="Preferred time" type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
            <Input label="Reason" hint="Optional. This stays in the hospital record." value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
            <Button type="submit" loading={saving} disabled={saving || !doctorId}>Submit request</Button>
          </form>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="My appointments" description="This list refreshes while the page is open.">
          {feed.phase === "loading" ? <LoadingSkeleton label="Loading appointments" /> : null}
          {feed.phase === "error" ? <ErrorState title="Appointments unavailable" message={feed.message} action={<Button onClick={feed.refresh}>Try again</Button>} /> : null}
          {feed.phase === "ready" && appointments.length === 0 ? (
            <EmptyState title="No appointments yet" description="A request appears here after you submit it." />
          ) : null}
          <div className="grid gap-4">
            {appointments.map((appointment) => {
              const confirmed = appointment.status === "confirmed" || appointment.status === "rescheduled";
              const open = appointment.status === "pending" || confirmed;
              const headline = appointment.status === "rescheduled" ? "Your appointment has been rescheduled." : "Your appointment has been confirmed.";
              return (
                <article key={appointment.id} className="rounded-xl border border-line p-4">
                  {confirmed ? <p className="mb-3 text-sm font-medium text-navy">{headline}</p> : null}
                  {confirmed ? <p className="mb-3 text-sm text-ink">{visitLine(appointment)}</p> : null}
                  <AppointmentFacts appointment={appointment} confirmed={confirmed} />
                  {appointment.reason ? <p className="mt-3 text-sm text-muted">Reason: {appointment.reason}</p> : null}
                  {appointment.doctorNotes ? <p className="mt-2 text-sm text-ink">Doctor instructions: {appointment.doctorNotes}</p> : null}
                  {appointment.rejectionReason ? <p className="mt-2 text-sm text-danger">Rejection note: {appointment.rejectionReason}</p> : null}
                  <p className="mt-3 text-xs text-muted">Requested {formatHospitalDate(appointment.createdAt)}</p>
                  {open ? (
                    <div className="mt-3">
                      <Button variant="secondary" onClick={() => cancel(appointment.id)}>Cancel</Button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
