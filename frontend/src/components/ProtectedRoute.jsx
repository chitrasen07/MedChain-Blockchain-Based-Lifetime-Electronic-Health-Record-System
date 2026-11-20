import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export function ProtectedRoute({ allow }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas" role="status">
        <p className="text-sm text-muted">Checking session</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    const signIn = allow === "patient" ? "/patient/login" : "/login";
    return <Navigate to={signIn} replace state={{ from: location.pathname }} />;
  }

  if (user.role !== allow) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
