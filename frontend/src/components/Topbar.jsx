import { Menu } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { roleLabel } from "../lib/roles";

export function Topbar({ title, onMenu, menuOpen = false }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const accountLabel = user ? roleLabel(user.role) : "Account not signed in";

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-navy hover:bg-canvas lg:hidden"
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          onClick={onMenu}
        >
          <Menu className="h-5 w-5" />
        </button>
        <p className="truncate text-sm font-medium text-navy">{title}</p>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <div className={`flex items-center gap-2 rounded-full border border-line bg-canvas py-1 pr-1 pl-1 sm:pr-3 ${menuOpen ? "max-lg:hidden" : ""}`}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface" aria-hidden="true" />
          <span className="sr-only">{user ? `Signed in as ${accountLabel}` : accountLabel}</span>
          <span className="hidden text-xs text-muted sm:inline" aria-hidden="true">
            {accountLabel}
          </span>
        </div>
        {user ? (
          <button
            type="button"
            onClick={signOut}
            className="inline-flex h-10 items-center rounded-lg px-2 text-sm font-medium text-teal hover:text-teal-dark"
          >
            Sign out
          </button>
        ) : (
          <Link
            to="/login"
            className="inline-flex h-10 items-center rounded-lg px-2 text-sm font-medium text-teal hover:text-teal-dark"
          >
            Staff login
          </Link>
        )}
      </div>
    </header>
  );
}
