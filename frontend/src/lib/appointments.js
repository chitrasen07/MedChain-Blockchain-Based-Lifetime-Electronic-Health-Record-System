export const HOSPITAL_ZONE = "Asia/Kolkata";
export const HOSPITAL_ZONE_LABEL = "India Standard Time (Asia/Kolkata)";

const labels = {
  pending: "Pending",
  confirmed: "Confirmed",
  rescheduled: "Rescheduled",
  rejected: "Rejected",
  cancelled: "Cancelled",
  completed: "Completed",
};

const tones = {
  pending: "warning",
  confirmed: "success",
  rescheduled: "info",
  rejected: "danger",
  cancelled: "neutral",
  completed: "success",
};

export function appointmentLabel(status) {
  return labels[status] || "Pending";
}

export function appointmentTone(status) {
  return tones[status] || "neutral";
}

export function appointmentNotice(previous, appointment) {
  if (!previous || !appointment || previous === appointment.status) return "";
  if (appointment.status === "confirmed") return "Your appointment has been confirmed.";
  if (appointment.status === "rescheduled") return "Your appointment has been rescheduled.";
  if (appointment.status === "rejected") return "Your appointment request was rejected.";
  if (appointment.status === "cancelled") return "Your appointment was cancelled.";
  return "";
}

export function formatHospitalDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: HOSPITAL_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function hospitalToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function visitLine(appointment) {
  if (!appointment?.confirmedDate || !appointment.confirmedTime) return "";
  const place = [appointment.hospitalName, appointment.department, appointment.room ? `Room ${appointment.room}` : ""]
    .filter(Boolean)
    .join(", ");
  return `Visit ${place} on ${appointment.confirmedDate} at ${appointment.confirmedTime}.`;
}
