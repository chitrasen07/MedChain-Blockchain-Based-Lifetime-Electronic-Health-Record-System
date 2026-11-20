import { readSession } from "./roles.js";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "server" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const FAILURE_MESSAGES = {
  unauthorized: "The email or password was not accepted.",
  forbidden: "This account cannot sign in.",
  invalid: "Check the email and password and try again.",
  rate_limited: "Too many sign-in attempts. Wait and try again.",
  network: "The hospital service could not be reached.",
  unavailable: "The hospital service could not be reached.",
  server: "Sign-in could not be completed. Try again later.",
};

export function messageForAuthFailure(error) {
  return FAILURE_MESSAGES[error?.code] ?? FAILURE_MESSAGES.server;
}

function resolveBase(baseUrl) {
  const value = typeof baseUrl === "function" ? baseUrl() : baseUrl;
  const trimmed = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ApiError("The hospital service could not be reached.", { status: 0, code: "unavailable" });
  }
  return trimmed;
}

const PUBLIC_CONFLICT_MESSAGES = new Set([
  "A staff account with this email already exists.",
  "Registration attempt is no longer retryable",
  "Registration review is not ready",
]);

function errorForStatus(status, serverMessage) {
  if (status === 401) return new ApiError(FAILURE_MESSAGES.unauthorized, { status, code: "unauthorized" });
  if (status === 403) return new ApiError(FAILURE_MESSAGES.forbidden, { status, code: "forbidden" });
  if (status === 400) return new ApiError(FAILURE_MESSAGES.invalid, { status, code: "invalid" });
  if (status === 404) return new ApiError("The requested record was not found.", { status, code: "not_found" });
  if (status === 409) {
    const message = PUBLIC_CONFLICT_MESSAGES.has(serverMessage)
      ? serverMessage
      : "That action conflicts with the current record.";
    return new ApiError(message, { status, code: "conflict" });
  }
  if (status === 429) return new ApiError(FAILURE_MESSAGES.rate_limited, { status, code: "rate_limited" });
  if (status === 503) return new ApiError(FAILURE_MESSAGES.unavailable, { status, code: "unavailable" });
  return new ApiError(FAILURE_MESSAGES.server, { status, code: "server" });
}

const REQUEST_MESSAGES = {
  unauthorized: "Your session has ended. Sign in again.",
  forbidden: "This account cannot perform that action.",
  invalid: "Check the entered information and try again.",
  not_found: "The requested record was not found.",
  conflict: "That action conflicts with the current record.",
  rate_limited: "Too many requests. Wait and try again.",
  network: "The hospital service could not be reached.",
  unavailable: "The hospital service could not be reached.",
  timeout: "The hospital service did not respond in time. This does not confirm a registration.",
  server: "The hospital service could not complete the request.",
};

export function messageForRequest(error) {
  if (error?.code === "conflict" && PUBLIC_CONFLICT_MESSAGES.has(error.message)) return error.message;
  return REQUEST_MESSAGES[error?.code] ?? REQUEST_MESSAGES.server;
}

export function createApiClient({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
  let accessToken = null;
  let onUnauthorized = null;

  async function request(path, { method = "GET", body, authenticated = true, timeoutMs = 60_000 } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authenticated && accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let response;
    try {
      response = await fetchImpl(`${resolveBase(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new ApiError(REQUEST_MESSAGES.timeout, { status: 0, code: "timeout" });
      }
      throw new ApiError(FAILURE_MESSAGES.network, { status: 0, code: "network" });
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      if (response.status === 401 && authenticated) onUnauthorized?.();
      const serverMessage = payload && typeof payload.error === "string" ? payload.error : "";
      const error = errorForStatus(response.status, serverMessage);
      if (payload && payload.status === "registration_failed") error.resultStatus = payload.status;
      throw error;
    }

    if (response.status === 204) return null;
    if (payload === null) throw new ApiError(FAILURE_MESSAGES.server, { status: response.status, code: "server" });
    return payload;
  }

  return {
    setAccessToken(token) {
      accessToken = typeof token === "string" && token ? token : null;
    },
    setUnauthorizedHandler(handler) {
      onUnauthorized = typeof handler === "function" ? handler : null;
    },
    request,
    async login(email, password) {
      const payload = await request("/auth/token", {
        method: "POST",
        body: { email, password },
        authenticated: false,
      });
      if (!payload || typeof payload.token !== "string" || !readSession(payload.token)) {
        throw new ApiError(FAILURE_MESSAGES.server, { status: 502, code: "server" });
      }
      return payload.token;
    },
  };
}

export const apiClient = createApiClient({
  baseUrl: () => import.meta.env?.VITE_API_URL,
});
