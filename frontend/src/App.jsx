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
import { DoctorEmergencyPage, DoctorLookupPage, DoctorOverviewPage, DoctorRecordsPage, DoctorVisitsPage } from "./pages/doctor/DoctorPages";
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
import {
  ReceptionistLookupPage,
  ReceptionistMatchingPage,
  ReceptionistOverviewPage,
} from "./pages/receptionist/ReceptionistPages";
import { ReviewerMatchingPage, ReviewerOverviewPage, ReviewerQueuePage } from "./pages/reviewer/ReviewerPages";
import { StaffEmergencyPage, StaffLookupPage, StaffOverviewPage, StaffRecordsPage, StaffVisitsPage } from "./pages/staff/StaffPages";
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
            <Route path="/doctor/lookup" element={<DoctorLookupPage />} />
            <Route path="/doctor/visits" element={<DoctorVisitsPage />} />
            <Route path="/doctor/records" element={<DoctorRecordsPage />} />
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
            <Route path="/staff/lookup" element={<StaffLookupPage />} />
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
            <Route path="/patient/identity" element={<PatientIdentityPage />} />
            <Route path="/patient/ownership" element={<PatientOwnershipPage />} />
            <Route path="/patient/history" element={<PatientHistoryPage />} />
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
