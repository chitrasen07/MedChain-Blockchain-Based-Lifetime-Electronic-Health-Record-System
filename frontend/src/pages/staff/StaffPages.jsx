import { ClinicalRecordScreen } from "../../features/ClinicalRecordScreen";
import { EmergencyAccessScreen } from "../../features/EmergencyAccessScreen";
import { NursingIntakeScreen } from "../../features/NursingIntakeScreen";
import { PatientLookupScreen } from "../../features/PatientLookupScreen";
import { PatientMatchScreen } from "../../features/PatientMatchScreen";
import { VisitReferenceScreen } from "../../features/VisitReferenceScreen";
import { WorkQueueScreen } from "../../features/WorkQueueScreen";
import { WorkspaceScreen } from "../WorkspaceScreen";

export function StaffOverviewPage() {
  return <WorkspaceScreen pageKey="staff-overview" />;
}
export function StaffRegistrationPage() {
  return <PatientMatchScreen pageKey="staff-registration" canRegister />;
}
export function StaffLookupPage() {
  return <PatientLookupScreen pageKey="staff-lookup" intake />;
}
export function StaffVitalsPage() {
  return <NursingIntakeScreen pageKey="staff-vitals" kind="vital" />;
}
export function StaffNotesPage() {
  return <NursingIntakeScreen pageKey="staff-notes" kind="visit_note" />;
}
export function StaffLabsPage() {
  return <NursingIntakeScreen pageKey="staff-labs" kind="laboratory" />;
}
export function StaffQueuePage() {
  return <WorkQueueScreen pageKey="staff-queue" />;
}
export function StaffVisitsPage() {
  return <VisitReferenceScreen pageKey="staff-visits" />;
}
export function StaffRecordsPage() {
  return <ClinicalRecordScreen pageKey="staff-records" canWrite={false} canAnchor={false} />;
}
export function StaffEmergencyPage() {
  return <EmergencyAccessScreen pageKey="staff-emergency" />;
}
