import { useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { ApiError, apiClient, messageForRequest } from "../lib/api";

const FIELDS = [
  ["fullName", "Name"],
  ["dateOfBirth", "Date of birth", "date"],
  ["gender", "Gender"],
  ["bloodGroup", "Blood group"],
  ["mobile", "Mobile"],
  ["email", "Email", "email"],
  ["emergencyContact", "Emergency contact"],
];

export function DemographicCorrectionForm({ patientId }) {
  const [fields, setFields] = useState({});
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    const body = { reason: reason.trim() };
    for (const [name] of FIELDS) {
      const value = String(fields[name] || "").trim();
      if (value) body[name] = value;
    }
    if (Object.keys(body).length < 2) {
      setNotice("Enter at least one corrected field. The lifetime Patient ID does not change.");
      return;
    }
    if (body.reason.length < 3) {
      setNotice("Enter the reason for this correction.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await apiClient.request(`/patients/${encodeURIComponent(patientId)}/demographic-corrections`, { method: "POST", body });
      setFields({});
      setReason("");
      setNotice("Correction saved. The original registration remains stored, and this version is now shown.");
    } catch (error) {
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The correction was not saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-4 border-t border-line pt-4" onSubmit={onSubmit} noValidate>
      <h3 className="text-sm font-semibold text-navy">Correct demographics</h3>
      <p className="mt-1 text-sm leading-6 text-muted">This stores a new encrypted version. It does not change the Patient ID, the original registration, or the blockchain owner.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([name, label, type]) => (
          <Input key={name} label={label} name={name} type={type || "text"} value={fields[name] || ""} onChange={(event) => setFields((current) => ({ ...current, [name]: event.target.value }))} />
        ))}
        <Input className="sm:col-span-2" label="Correction reason" name="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      {notice ? <p role="status" className="mt-3 text-sm leading-6 text-ink">{notice}</p> : null}
      <Button className="mt-3" type="submit" variant="secondary" loading={saving} disabled={saving}>Save correction</Button>
    </form>
  );
}
