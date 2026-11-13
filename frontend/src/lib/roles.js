export const STAFF_ROLES = ["administrator", "doctor", "receptionist", "hospital_staff", "reviewer"];

const HOME = {
  administrator: "/admin",
  doctor: "/doctor",
  receptionist: "/receptionist",
  hospital_staff: "/staff",
  reviewer: "/reviewer",
};

const LABELS = {
  administrator: "Hospital administrator",
  doctor: "Doctor",
  receptionist: "Receptionist",
  hospital_staff: "Hospital staff",
  reviewer: "Reviewer",
};

const MAX_SESSION_MS = 20 * 60 * 1000;

export function homeForRole(role) {
  return HOME[role] ?? null;
}

export function roleLabel(role) {
  return LABELS[role] ?? "Staff";
}

export function pathAllowedForRole(role, path) {
  const home = homeForRole(role);
  if (!home || typeof path !== "string") return false;
  return path === home || path.startsWith(`${home}/`);
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function readSession(token, now = Date.now()) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;

  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
  if (typeof payload.hospitalId !== "string" || payload.hospitalId.length === 0) return null;
  if (!STAFF_ROLES.includes(payload.role)) return null;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;

  const expiresAt = payload.exp * 1000;
  const remaining = expiresAt - now;
  if (remaining <= 0 || remaining > MAX_SESSION_MS) return null;

  return {
    id: payload.sub,
    role: payload.role,
    hospitalId: payload.hospitalId,
    expiresAt,
  };
}
