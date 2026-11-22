const COOKIE_NAME = "medchain_session";
const CSRF_HEADER = "x-medchain-request";
const MAX_AGE = 15 * 60;

function readCookie(header, name) {
  if (typeof header !== "string" || header.length === 0 || header.length > 8192) return "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    if (!value || value.length > 4096) return "";
    try { return decodeURIComponent(value); } catch { return ""; }
  }
  return "";
}

function readAuthToken(req) {
  const header = req.headers.authorization;
  if (typeof header === "string" && /^Bearer\s+\S+$/i.test(header.trim())) {
    return { token: header.replace(/^Bearer\s+/i, "").trim(), source: "bearer" };
  }
  const token = readCookie(req.headers.cookie, COOKIE_NAME);
  return token ? { token, source: "cookie" } : null;
}

function csrfAccepted(req, source) {
  if (source !== "cookie") return true;
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  return req.get(CSRF_HEADER) === "1";
}

function writeCookie(res, value, { secure = false, maxAge = MAX_AGE } = {}) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${maxAge}`,
    `SameSite=${secure ? "None" : "Lax"}`
  ];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function setSessionCookie(res, token, options) {
  writeCookie(res, token, options);
}

function clearSessionCookie(res, options) {
  writeCookie(res, "", { ...options, maxAge: 0 });
}

module.exports = {
  COOKIE_NAME,
  CSRF_HEADER,
  readAuthToken,
  csrfAccepted,
  setSessionCookie,
  clearSessionCookie
};
