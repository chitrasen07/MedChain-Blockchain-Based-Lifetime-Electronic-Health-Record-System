export const MEDICAL_FILE_LIMIT = 10 * 1024 * 1024;

export const MEDICAL_FILE_CATEGORIES = [
  ["xray", "X-ray"],
  ["blood_test", "Blood test"],
  ["mri_ct", "MRI / CT"],
  ["ecg", "ECG"],
  ["prescription", "Prescription"],
  ["other", "Other medical document"],
];

export function medicalFileProblem(file) {
  if (!file) return "Choose a PDF, JPG, or PNG.";
  if (file.size > MEDICAL_FILE_LIMIT) return "This file is larger than 10 MB.";
  const name = String(file.name || "").toLowerCase();
  if (!/\.(pdf|png|jpe?g)$/.test(name)) return "This file type is not accepted. Use a PDF, JPG, or PNG.";
  return "";
}

export function formatFileTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date).replace(/\s*am$/i, " AM").replace(/\s*pm$/i, " PM");
  return `${formatted} IST`;
}
