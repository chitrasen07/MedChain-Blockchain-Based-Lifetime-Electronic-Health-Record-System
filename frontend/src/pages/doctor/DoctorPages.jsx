import { ClinicalRecordScreen } from "../../features/ClinicalRecordScreen";
import { EmergencyAccessScreen } from "../../features/EmergencyAccessScreen";
import { PatientLookupScreen } from "../../features/PatientLookupScreen";
import { VisitReferenceScreen } from "../../features/VisitReferenceScreen";
import { WorkspaceScreen } from "../WorkspaceScreen";

export function DoctorOverviewPage() {
  return <WorkspaceScreen pageKey="doctor-overview" />;
}
export function DoctorLookupPage() {
  return <PatientLookupScreen pageKey="doctor-lookup" chart />;
}
export function DoctorVisitsPage() {
  return <VisitReferenceScreen pageKey="doctor-visits" />;
}
export function DoctorRecordsPage() {
  return <ClinicalRecordScreen pageKey="doctor-records" />;
}
export function DoctorEmergencyPage() {
  return <EmergencyAccessScreen pageKey="doctor-emergency" />;
}
