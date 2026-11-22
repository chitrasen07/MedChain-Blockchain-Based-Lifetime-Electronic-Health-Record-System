import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthProvider } from "./context/AuthContext";
import { workspaces } from "./config/workspaces";
import {
  AdminMatchingPage,
  AdminOverviewPage,
  AdminRegistrationPage,
  AdminReviewsPage,
  AdminStaffPage,
} from "./pages/admin/AdminPages";
import { DoctorEmergencyPage, DoctorLookupPage, DoctorOverviewPage, DoctorRecordsPage, DoctorReviewPage, DoctorVisitsPage } from "./pages/doctor/DoctorPages";
import { DoctorAppointmentsPage } from "./features/DoctorAppointments";
import { PatientAppointmentsPage } from "./features/PatientAppointments";
import { ActivityScreen } from "./features/ActivityScreen";
import { EmergencyDashboardPage } from "./pages/emergency/EmergencyDashboardPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PatientLoginPage } from "./pages/patient/PatientLoginPage";
import {
  PatientAccessPage,
  PatientDashboardPage,
  PatientHistoryPage,
  PatientIdentityPage,
  PatientOwnershipPage,
  PatientProfilePage,
  PatientRecordsPage,
} from "./pages/patient/PatientPortalPages";
import { PatientChartPage } from "./pages/patient/PatientChartPage";
import {
  ReceptionistLookupPage,
  ReceptionistMatchingPage,
  ReceptionistOverviewPage,
} from "./pages/receptionist/ReceptionistPages";
import { ReviewerMatchingPage, ReviewerOverviewPage, ReviewerQueuePage } from "./pages/reviewer/ReviewerPages";
import { StaffEmergencyPage, StaffLabsPage, StaffLookupPage, StaffNotesPage, StaffOverviewPage, StaffQueuePage, StaffRecordsPage, StaffRegistrationPage, StaffVitalsPage, StaffVisitsPage } from "./pages/staff/StaffPages";
import { UnauthorizedPage } from "./pages/UnauthorizedPage";
import { WelcomePage } from "./pages/WelcomePage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/patient/login" element={<PatientLoginPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />

        <Route element={<ProtectedRoute allow="administrator" />}>
          <Route element={<AppLayout workspace={workspaces.administrator} />}>
            <Route path="/admin" element={<AdminOverviewPage />} />
            <Route path="/admin/activity" element={<ActivityScreen path="/admin/activity" title="Hospital activity" description="Operational and security events for this hospital. Encrypted clinical text is not included." crumbs={[{ label: "Hospital Admin", to: "/admin" }, { label: "Activity" }]} />} />
            <Route path="/admin/registration" element={<AdminRegistrationPage />} />
            <Route path="/admin/matching" element={<AdminMatchingPage />} />
            <Route path="/admin/reviews" element={<AdminReviewsPage />} />
            <Route path="/admin/staff" element={<AdminStaffPage />} />
            <Route path="/admin/password" element={<ChangePasswordPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allow="doctor" />}>
          <Route element={<AppLayout workspace={workspaces.doctor} />}>
            <Route path="/doctor" element={<DoctorOverviewPage />} />
            <Route path="/doctor/appointments" element={<DoctorAppointmentsPage />} />
            <Route path="/doctor/activity" element={<ActivityScreen path="/doctor/activity" title="My activity" description="Your sign-ins, clinical access, and appointment actions. A patient's history opens only while you have current access." crumbs={[{ label: "Doctor", to: "/doctor" }, { label: "Activity" }]} allowPatient />} />
            <Route path="/doctor/lookup" element={<DoctorLookupPage />} />
            <Route path="/doctor/visits" element={<DoctorVisitsPage />} />
            <Route path="/doctor/records" element={<DoctorRecordsPage />} />
            <Route path="/doctor/review" element={<DoctorReviewPage />} />
            <Route path="/doctor/emergency" element={<DoctorEmergencyPage />} />
            <Route path="/doctor/password" element={<ChangePasswordPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allow="receptionist" />}>
          <Route element={<AppLayout workspace={workspaces.receptionist} />}>
            <Route path="/receptionist" element={<ReceptionistOverviewPage />} />
            <Route path="/receptionist/matching" element={<ReceptionistMatchingPage />} />
            <Route path="/receptionist/lookup" element={<ReceptionistLookupPage />} />
            <Route path="/receptionist/password" element={<ChangePasswordPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allow="hospital_staff" />}>
          <Route element={<AppLayout workspace={workspaces.staff} />}>
            <Route path="/staff" element={<StaffOverviewPage />} />
            <Route path="/staff/activity" element={<ActivityScreen path="/staff/activity" title="My activity" description="Your own nursing and account activity for this hospital." crumbs={[{ label: "Hospital Staff", to: "/staff" }, { label: "Activity" }]} />} />
            <Route path="/staff/registration" element={<StaffRegistrationPage />} />
            <Route path="/staff/lookup" element={<StaffLookupPage />} />
            <Route path="/staff/vitals" element={<StaffVitalsPage />} />
            <Route path="/staff/notes" element={<StaffNotesPage />} />
            <Route path="/staff/labs" element={<StaffLabsPage />} />
            <Route path="/staff/queue" element={<StaffQueuePage />} />
            <Route path="/staff/visits" element={<StaffVisitsPage />} />
            <Route path="/staff/records" element={<StaffRecordsPage />} />
            <Route path="/staff/emergency" element={<StaffEmergencyPage />} />
            <Route path="/staff/password" element={<ChangePasswordPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allow="reviewer" />}>
          <Route element={<AppLayout workspace={workspaces.reviewer} />}>
            <Route path="/reviewer" element={<ReviewerOverviewPage />} />
            <Route path="/reviewer/queue" element={<ReviewerQueuePage />} />
            <Route path="/reviewer/matching" element={<ReviewerMatchingPage />} />
            <Route path="/reviewer/password" element={<ChangePasswordPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allow="patient" />}>
          <Route element={<AppLayout workspace={workspaces.patient} />}>
            <Route path="/patient" element={<PatientDashboardPage />} />
            <Route path="/patient/appointments" element={<PatientAppointmentsPage />} />
            <Route path="/patient/activity" element={<ActivityScreen path="/patient-portal/activity" title="My Activity & Access History" description="Who viewed or changed your record, your sign-ins, appointments, and consent activity. Times are shown in India Standard Time." crumbs={[{ label: "Patient", to: "/patient" }, { label: "Activity" }]} />} />
            <Route path="/patient/identity" element={<PatientIdentityPage />} />
            <Route path="/patient/ownership" element={<PatientOwnershipPage />} />
            <Route path="/patient/history" element={<PatientHistoryPage />} />
            <Route path="/patient/chart" element={<PatientChartPage />} />
            <Route path="/patient/records" element={<PatientRecordsPage />} />
            <Route path="/patient/access" element={<PatientAccessPage />} />
            <Route path="/patient/profile" element={<PatientProfilePage />} />
          </Route>
        </Route>
        <Route element={<AppLayout workspace={workspaces.emergency} />}>
          <Route path="/emergency" element={<EmergencyDashboardPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
