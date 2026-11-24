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

function credential(value) {
  return value || "Not provided";
}

function verificationLabel(status) {
  if (status === "verified") return "Credentials verified";
  if (status === "pending") return "Credentials pending verification";
  if (status === "changes_requested") return "Credential changes requested";
  return "Credentials incomplete";
}

function degreeText(doctor) {
  if (Array.isArray(doctor.degrees)) return doctor.degrees.filter(Boolean).join(", ");
  return doctor.degrees || "";
}

function experienceText(value) {
  return Number.isInteger(value) ? `${value} years` : "Not provided";
}

function DoctorAvatar({ name, photoAvailable, path }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!photoAvailable || !path) return undefined;
    let active = true;
    let objectUrl = "";
    apiClient.download(path).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }, () => { if (active) setUrl(""); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoAvailable, path]);
  const initials = String(name || "Dr").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  if (url) return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />;
  return <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-navy" aria-hidden="true">{initials || "Dr"}</div>;
}

function DoctorCard({ doctor, selected, onBook, onView }) {
  const verified = doctor.verificationStatus === "verified";
  return (
    <article className={`rounded-xl border px-4 py-3 ${selected ? "border-teal bg-teal/5" : "border-line bg-surface"}`}>
      <div className="flex items-start gap-3">
        <DoctorAvatar name={doctor.fullName} photoAvailable={doctor.photoAvailable} path={`/patient-portal/doctors/${doctor.id}/photo`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-navy">{doctor.fullName}</h3>
            <StatusBadge tone={verified ? "success" : "warning"}>{verificationLabel(doctor.verificationStatus)}</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-muted">{credential(degreeText(doctor))} · {credential(doctor.hospitalName)}</p>
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Specialization</dt><dd>{credential(doctor.specialization)}</dd></div>
        <div><dt className="text-muted">Experience</dt><dd>{experienceText(doctor.experienceYears)}</dd></div>
        <div><dt className="text-muted">Department</dt><dd>{credential(doctor.department)}</dd></div>
        <div><dt className="text-muted">Consultation hours</dt><dd>{credential(doctor.consultationHours)}</dd></div>
      </dl>
      {verified ? null : <p className="mt-2 text-xs leading-5 text-muted">These professional details are not verified credentials.</p>}
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onView}>View profile</Button>
        <Button type="button" size="sm" onClick={onBook}>Book appointment</Button>
      </div>
    </article>
  );
}

function DoctorProfilePanel({ doctor, onClose }) {
  const [detail, setDetail] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    apiClient.request(`/patient-portal/doctors/${doctor.id}`).then((data) => {
      if (active) setDetail(data);
    }, (error) => {
      if (active) setMessage(error instanceof ApiError ? messageForRequest(error) : "The profile could not be opened.");
    });
    return () => { active = false; };
  }, [doctor.id]);
  const verified = detail?.verificationStatus === "verified";
  return (
    <div className="mt-4 rounded-xl border border-line bg-canvas px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-navy">{doctor.fullName}</h3>
        <Button type="button" size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </div>
      {message ? <p className="mt-3 text-sm text-danger">{message}</p> : null}
      {!detail && !message ? <LoadingSkeleton label="Loading profile" /> : null}
      {detail ? (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Verification</dt><dd>{verificationLabel(detail.verificationStatus)}</dd></div>
          <div><dt className="text-muted">Hospital</dt><dd>{credential(detail.hospitalName)}</dd></div>
          <div><dt className="text-muted">Specialization</dt><dd>{credential(detail.specialization)}</dd></div>
          <div><dt className="text-muted">Experience</dt><dd>{experienceText(detail.experienceYears)}</dd></div>
          <div><dt className="text-muted">Department</dt><dd>{credential(detail.department)}</dd></div>
          <div><dt className="text-muted">Languages</dt><dd>{credential(detail.languages)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted">Biography</dt><dd>{credential(detail.biography)}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Education</dt>
            <dd>{detail.qualifications?.length ? detail.qualifications.map((item) => `${item.degree}, ${item.institution}${item.graduationYear ? ` (${item.graduationYear})` : ""}`).join("; ") : "Not provided"}</dd>
          </div>
          {verified ? null : <p className="sm:col-span-2 text-xs leading-5 text-muted">These professional details are not verified credentials.</p>}
        </dl>
      ) : null}
    </div>
  );
}

function AppointmentFacts({ appointment, confirmed = false }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">Doctor</dt>
        <dd className="mt-1 text-sm text-ink">{appointment.doctorName}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium tracking-wide text-muted uppercase">Specialization</dt>
        <dd className="mt-1 text-sm text-ink">{appointment.specialization || "Not provided"}</dd>
      </div>
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
  const [specialty, setSpecialty] = useState("");
  const [department, setDepartment] = useState("");
  const [experience, setExperience] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [viewed, setViewed] = useState(null);
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
    apiClient.request("/patient-portal/appointments/doctors").then(
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
  }, []);

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
  const minimumExperience = Number(experience);
  const visibleDoctors = doctors.items.filter((doctor) => {
    const name = String(doctor.fullName || "").toLowerCase();
    const focus = String(doctor.specialization || "").toLowerCase();
    const unit = String(doctor.department || "").toLowerCase();
    if (query.trim() && !name.includes(query.trim().toLowerCase())) return false;
    if (specialty.trim() && !focus.includes(specialty.trim().toLowerCase())) return false;
    if (department.trim() && !unit.includes(department.trim().toLowerCase())) return false;
    if (experience.trim() && Number.isFinite(minimumExperience) && (doctor.experienceYears ?? -1) < minimumExperience) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        eyebrow="Patient"
        title="Appointments"
        description={`Request a visit with a doctor authorized by your hospital. Times use ${HOSPITAL_ZONE_LABEL}. The doctor confirms when and where you should come.`}
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
        <Card title="Choose a doctor" description="Only doctors with an active hospital account and blockchain role are listed. Consultation hours are informational and are not open slots.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Doctor name" value={query} onChange={(event) => setQuery(event.target.value)} />
            <Input label="Specialization" value={specialty} onChange={(event) => setSpecialty(event.target.value)} />
            <Input label="Department" value={department} onChange={(event) => setDepartment(event.target.value)} />
            <Input label="Minimum years of experience" value={experience} onChange={(event) => setExperience(event.target.value)} inputMode="numeric" />
          </div>
          {doctors.phase === "loading" ? <LoadingSkeleton label="Loading doctors" /> : null}
          {doctors.phase === "error" ? <ErrorState title="Doctors unavailable" message={doctors.message} /> : null}
          {doctors.phase === "ready" && visibleDoctors.length === 0 ? (
            <EmptyState title="No doctors match" description="Try another name or specialty, or ask the hospital to authorize the doctor." />
          ) : null}
          <div className="mt-4 grid gap-3">
            {visibleDoctors.map((doctor) => (
              <DoctorCard
                key={doctor.id}
                doctor={doctor}
                selected={doctor.id === doctorId}
                onBook={() => setDoctorId(doctor.id)}
                onView={() => setViewed(doctor)}
              />
            ))}
          </div>
          {viewed ? <DoctorProfilePanel doctor={viewed} onClose={() => setViewed(null)} /> : null}
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
