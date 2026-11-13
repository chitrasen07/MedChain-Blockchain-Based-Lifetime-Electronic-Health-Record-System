import { useEffect } from "react";
import { Button } from "../components/Button";
import { ErrorState } from "../components/ErrorState";
import { useAuth } from "../context/useAuth";
import { homeForRole } from "../lib/roles";

export function UnauthorizedPage() {
  const { isAuthenticated, user } = useAuth();
  const home = user ? homeForRole(user.role) : null;

  useEffect(() => {
    document.title = "Access Restricted · MedChain";
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-lg">
        <ErrorState
          heading="h1"
          title="Access Restricted"
          message={
            isAuthenticated
              ? "This staff account does not have permission to open that workspace."
              : "Sign in with a staff account to open a hospital workspace."
          }
          action={
            <>
              <Button to="/" variant="secondary">
                Back to welcome
              </Button>
              {home ? <Button to={home}>Your workspace</Button> : <Button to="/login">Staff login</Button>}
            </>
          }
        />
      </div>
    </div>
  );
}
