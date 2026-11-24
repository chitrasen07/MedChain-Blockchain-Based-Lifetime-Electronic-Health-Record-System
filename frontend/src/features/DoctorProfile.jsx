import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { Input } from "../components/Input";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, apiClient, messageForRequest } from "../lib/api";

const emptyQualification = { degree: "", institution: "", graduationYear: "", extra: "" };

function statusLabel(status) {
  if (status === "verified") return "Verified";
  if (status === "pending") return "Pending verification";
  if (status === "changes_requested") return "Changes requested";
  return "Incomplete";
}

function statusTone(status) {
  if (status === "verified") return "success";
  if (status === "pending" || status === "changes_requested") return "warning";
  return "info";
}

function shown(value) {
  return value || "Not provided";
}

export function DoctorProfilePage() {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");

  useEffect(() => {
    document.title = "My Profile · MedChain";
  }, []);

  useEffect(() => {
    let active = true;
    apiClient.request("/doctor/profile").then((data) => {
      if (!active) return;
      setProfile(data);
      setForm(formFrom(data));
    }, (loadError) => {
      if (active) setError(loadError instanceof ApiError ? messageForRequest(loadError) : "The profile could not be loaded.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!profile?.photoAvailable) return undefined;
    let url = "";
    let active = true;
    apiClient.download("/doctor/profile/photo").then((blob) => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setPhotoUrl(url);
    }, () => { if (active) setPhotoUrl(""); });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [profile?.photoAvailable]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setNotice("");
    setSaving(true);
    try {
      const saved = await apiClient.request("/doctor/profile", { method: "PUT", body: payload(form) });
      setProfile(saved);
      setForm(formFrom(saved));
      setNotice(saved.verificationStatus === "verified"
        ? "The profile was saved. Verified credentials were not changed."
        : saved.verificationStatus === "pending"
          ? "The profile was submitted for hospital review. It is not shown as verified until an administrator approves it."
          : "The profile was saved. Add the required credentials before it can be reviewed.");
    } catch (saveError) {
      setNotice(saveError instanceof ApiError ? messageForRequest(saveError) : "The profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setNotice("");
    try {
      await apiClient.uploadFile("/doctor/profile/photo", file, { category: "profile" });
      setProfile((current) => ({ ...current, photoAvailable: true }));
      setNotice("The profile photo was saved. It is separate from medical files.");
    } catch (uploadError) {
      setNotice(uploadError instanceof ApiError ? messageForRequest(uploadError) : "The profile photo could not be saved.");
    }
  }

  if (error) return <ErrorState title="Profile unavailable" message={error} />;
  if (!form || !profile) return <LoadingSkeleton label="Loading professional profile" />;

  return (
    <div>
      <PageHeader
        eyebrow="Doctor"
        title="My Profile"
        description="Professional details are reviewed by your hospital. They do not change your role, and a verified wallet does not verify your qualifications."
        crumbs={[{ label: "Doctor", to: "/doctor" }, { label: "My Profile" }]}
      />
      <Card title={profile.fullName || "Doctor"} description={profile.hospitalName || "Hospital"}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {photoUrl ? <img src={photoUrl} alt="" className="h-20 w-20 rounded-full object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-full bg-canvas text-sm text-muted">Photo</div>}
          <div>
            <StatusBadge tone={statusTone(profile.verificationStatus)}>{statusLabel(profile.verificationStatus)}</StatusBadge>
            <p className="mt-2 text-sm text-muted">Staff identifier {profile.id}</p>
            {profile.reviewNote ? <p className="mt-2 text-sm text-ink">Hospital note: {profile.reviewNote}</p> : null}
            <label className="mt-3 inline-flex cursor-pointer text-sm font-medium text-teal">
              Upload photo
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} />
            </label>
          </div>
        </div>
      </Card>
      <form className="mt-4 grid gap-4" onSubmit={save}>
        <Card title="Basic information">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" value={form.fullName} onChange={(event) => update("fullName", event.target.value)} />
            <Input label="Professional biography" value={form.biography} onChange={(event) => update("biography", event.target.value)} maxLength={2000} />
          </div>
        </Card>
        <Card title="Education and qualifications" description="Add each degree separately. These credentials need hospital review.">
          <div className="grid gap-4">
            {form.qualifications.map((item, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-2">
                <Input label="Degree" value={item.degree} onChange={(event) => updateQualification(setForm, index, "degree", event.target.value)} placeholder="MBBS" />
                <Input label="College or university" value={item.institution} onChange={(event) => updateQualification(setForm, index, "institution", event.target.value)} />
                <Input label="Graduation year" value={item.graduationYear} onChange={(event) => updateQualification(setForm, index, "graduationYear", event.target.value)} inputMode="numeric" />
                <Input label="Additional qualification" value={item.extra} onChange={(event) => updateQualification(setForm, index, "extra", event.target.value)} />
              </div>
            ))}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm((current) => ({ ...current, qualifications: [...current.qualifications, { ...emptyQualification }] }))}>Add qualification</Button>
              {form.qualifications.length > 1 ? <Button type="button" variant="secondary" onClick={() => setForm((current) => ({ ...current, qualifications: current.qualifications.slice(0, -1) }))}>Remove last</Button> : null}
            </div>
          </div>
        </Card>
        <Card title="Professional information" description={`Hospital: ${shown(profile.hospitalName)}. The assigned hospital and role stay with the administrator.`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Specialization" value={form.specialization} onChange={(event) => update("specialization", event.target.value)} />
            <Input label="Registration number" value={form.registrationNumber} onChange={(event) => update("registrationNumber", event.target.value)} />
            <Input label="Registering council" value={form.registrationCouncil} onChange={(event) => update("registrationCouncil", event.target.value)} />
            <Input label="Years of experience" value={form.experienceYears} onChange={(event) => update("experienceYears", event.target.value)} inputMode="numeric" />
            <Input label="Department" value={form.department} onChange={(event) => update("department", event.target.value)} />
            <Input label="Designation" value={form.designation} onChange={(event) => update("designation", event.target.value)} />
            <Input label="Languages" value={form.languages} onChange={(event) => update("languages", event.target.value)} />
            <Input label="Consultation days and hours" value={form.consultationHours} onChange={(event) => update("consultationHours", event.target.value)} hint="Informational only. These are not guaranteed appointment slots." />
          </div>
        </Card>
        {notice ? <p role="status" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
        <Button type="submit" loading={saving} disabled={saving}>Save profile</Button>
      </form>
    </div>
  );
}

function formFrom(profile) {
  const qualifications = profile.qualifications?.length ? profile.qualifications : [emptyQualification];
  return {
    fullName: profile.fullName || "",
    biography: profile.biography || "",
    specialization: profile.specialization || "",
    registrationNumber: profile.registrationNumber || "",
    registrationCouncil: profile.registrationCouncil || "",
    experienceYears: profile.experienceYears ?? "",
    department: profile.department || "",
    designation: profile.designation || "",
    languages: profile.languages || "",
    consultationHours: profile.consultationHours || "",
    qualifications: qualifications.map((item) => ({
      degree: item.degree || "",
      institution: item.institution || "",
      graduationYear: item.graduationYear || "",
      extra: item.extra || "",
    })),
  };
}

function payload(form) {
  const qualifications = form.qualifications
    .map((item) => ({
      degree: item.degree.trim(),
      institution: item.institution.trim(),
      graduationYear: item.graduationYear ? Number(item.graduationYear) : null,
      extra: item.extra.trim(),
    }))
    .filter((item) => item.degree || item.institution || item.extra);
  return {
    fullName: form.fullName.trim(),
    biography: form.biography.trim(),
    specialization: form.specialization.trim(),
    registrationNumber: form.registrationNumber.trim(),
    registrationCouncil: form.registrationCouncil.trim(),
    experienceYears: form.experienceYears === "" ? null : Number(form.experienceYears),
    department: form.department.trim(),
    designation: form.designation.trim(),
    languages: form.languages.trim(),
    consultationHours: form.consultationHours.trim(),
    qualifications,
  };
}

function updateQualification(setForm, index, field, value) {
  setForm((current) => ({
    ...current,
    qualifications: current.qualifications.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
  }));
}
