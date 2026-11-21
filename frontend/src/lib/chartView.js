export function anchorLabel(record) {
  if (record?.anchorStatus) return record.anchorStatus;
  if (record?.chainStatus === "anchored") return "Anchored";
  if (record?.chainStatus === "failed" || record?.chainStatus === "mismatch") return "Failed";
  if (record?.transaction) return "Pending";
  return "Not anchored";
}

export function anchorTone(label) {
  if (label === "Anchored") return "success";
  if (label === "Failed") return "danger";
  if (label === "Pending") return "warning";
  return "neutral";
}

export function exactAllergyAlert(allergies, medication) {
  const target = String(medication || "").trim().toLowerCase();
  if (!target) return [];
  return (allergies || []).filter((item) => String(item?.substance || "").trim().toLowerCase() === target);
}

export function filterTimeline(items, { query = "", category = "", from = "", to = "" } = {}) {
  const needle = query.trim().toLowerCase();
  return (items || []).filter((item) => {
    if (category && item.category !== category) return false;
    const day = String(item.at || "").slice(0, 10);
    if (from && day && day < from) return false;
    if (to && day && day > to) return false;
    if (!needle) return true;
    return `${item.title || ""} ${item.category || ""} ${item.clinician || ""}`.toLowerCase().includes(needle);
  });
}

export function emergencyCardUrl(origin, patientId) {
  if (!/^PATIENT-[0-9]{1,12}$/.test(patientId || "")) return "";
  const base = String(origin || "").replace(/\/$/, "");
  return `${base}/doctor/lookup?patientId=${encodeURIComponent(patientId)}`;
}

export function listText(items) {
  return Array.isArray(items) && items.length ? items.join(", ") : "Not recorded";
}
