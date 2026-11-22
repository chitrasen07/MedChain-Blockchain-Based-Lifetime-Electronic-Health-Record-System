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

function readRetryAfter(response, payload) {
  const fromBody = Number(payload?.retryAfterSeconds);
  if (Number.isInteger(fromBody) && fromBody > 0) return fromBody;
  const header = Number(response.headers?.get?.("retry-after"));
  if (Number.isInteger(header) && header > 0) return header;
  return 0;
}

function resolveBase(baseUrl) {
  const value = typeof baseUrl === "function" ? baseUrl() : baseUrl;
  const trimmed = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ApiError("The hospital service could not be reached.", { status: 0, code: "unavailable" });
  }
  return trimmed;
}

const PUBLIC_REQUEST_MESSAGES = new Set([
  "A staff account with this email already exists.",
  "This wallet is already linked to a staff account.",
  "The staff wallet must sign before a clinical account is created.",
  "A doctor account uses the Doctor chain role.",
  "Choose Nurse, Lab technician, Pharmacist, or Specialist for hospital staff.",
  "This role does not use a blockchain wallet.",
  "This role cannot be granted on the blockchain.",
  "The hospital administrator wallet cannot be the staff wallet.",
  "Enter the staff member's name.",
  "A patient with this identity commitment is already registered.",
  "Candidate is not part of this review.",
  "Registration attempt is no longer retryable",
  "Registration review is not ready",
  "This review case is still pending. Registration stays blocked until a reviewer marks the person as different.",
  "This review linked the profile to an existing patient. A new Patient ID was not created.",
  "This review was rejected. Registration is not authorized.",
  "This review is invalid because the entered patient details do not match that case.",
  "This review case has already been used for a registration.",
  "That review case was not found.",
  "A new possible match appeared after this review. Review the new case before registering.",
  "Do not send a recovery secret.",
  "The hospital wallet cannot anchor a medical record. Patient consent is required.",
  "Switch the wallet to Sepolia before anchoring. No transaction was sent.",
  "Switch MetaMask to the consented clinical wallet. No transaction was sent.",
  "This wallet does not have the Doctor role on Sepolia. No transaction was sent.",
  "This patient is not an active registered record. No transaction was sent.",
  "This patient has no wallet controller yet. No transaction was sent.",
  "This doctor does not have consent for this patient. No transaction was sent.",
  "Patient consent for this doctor has expired. No transaction was sent.",
  "Patient consent for this doctor was revoked. No transaction was sent.",
  "This version is already anchored. No transaction was sent.",
  "An anchor transaction is already pending for this version. No new transaction was sent.",
  "Anchor the previous version before this one. No transaction was sent.",
  "The prepared record hash does not match this version. No transaction was sent.",
  "The prepared transaction did not match this record. No transaction was sent.",
  "The anchor would fail on Sepolia. No transaction was sent.",
  "This wallet cannot anchor the record. Check the Doctor role and patient consent. No transaction was sent.",
  "This patient is not active on Sepolia. No transaction was sent.",
  "The transaction failed on Sepolia. The record was not anchored.",
  "The hospital signing wallet cannot grant, revoke, or use patient consent.",
  "Patient consent is required.",
  "This file type is not accepted. Use a PDF, JPG, or PNG.",
  "This file is larger than 10 MB.",
  "Enter a file category.",
  "Medical file storage is not configured.",
  "File not found",
  "Emergency access is limited to necessary medical information.",
  "Connect the clinical wallet that holds patient consent.",
  "This wallet is not eligible clinical staff on-chain.",
  "This wallet is not an emergency responder.",
  "Emergency access is in cooldown.",
  "Clinical wallet could not be verified.",
  "The current password was not accepted.",
  "The patient wallet must sign the link before registration.",
  "The wallet signature could not be verified.",
  "A hospital staff wallet cannot become the patient owner. Connect the patient's own wallet, or register now and link the wallet later.",
  "This lifetime ID is controlled by a hospital staff wallet. Patient sign-in is blocked until that controller proposes a transfer in MetaMask and the patient's wallet accepts it.",
  "This record is registered and the wallet is not linked yet. Complete the ownership claim below before signing in.",
  "This wallet does not control this lifetime ID.",
  "Patient sign-in could not be verified.",
  "Patient ownership verified.",
  "Choose an active doctor with a verified wallet.",
  "This doctor is not authorized on Sepolia.",
  "Choose a password that is different from the current password.",
  "Use at least 12 characters with a letter and a number.",
  "Too many password changes. Wait and try again.",
  "Check the appointment details and try again.",
  "Choose a future appointment date and time.",
  "Choose a doctor at this hospital.",
  "A verified doctor account is required.",
  "An appointment request for this doctor and time is already pending.",
  "This doctor already has an appointment at that time.",
  "This appointment can no longer be changed.",
  "Appointment not found.",
]);

function errorForStatus(status, serverMessage) {
  if (status === 401) {
    const message = PUBLIC_REQUEST_MESSAGES.has(serverMessage) ? serverMessage : FAILURE_MESSAGES.unauthorized;
    return new ApiError(message, { status, code: "unauthorized" });
  }
  if (status === 403) {
    const message = PUBLIC_REQUEST_MESSAGES.has(serverMessage) ? serverMessage : FAILURE_MESSAGES.forbidden;
    return new ApiError(message, { status, code: "forbidden" });
  }
  if (status === 400) {
    const message = PUBLIC_REQUEST_MESSAGES.has(serverMessage)
      ? serverMessage
      : FAILURE_MESSAGES.invalid;
    return new ApiError(message, { status, code: "invalid" });
  }
  if (status === 404) {
    const message = PUBLIC_REQUEST_MESSAGES.has(serverMessage)
      ? serverMessage
      : "The requested record was not found.";
    return new ApiError(message, { status, code: "not_found" });
  }
  if (status === 409) {
    const message = PUBLIC_REQUEST_MESSAGES.has(serverMessage)
      ? serverMessage
      : "That action conflicts with the current record.";
    return new ApiError(message, { status, code: "conflict" });
  }
  if (status === 429) {
    const message = PUBLIC_REQUEST_MESSAGES.has(serverMessage) ? serverMessage : FAILURE_MESSAGES.rate_limited;
    return new ApiError(message, { status, code: "rate_limited" });
  }
  if (status === 503) {
    const message = PUBLIC_REQUEST_MESSAGES.has(serverMessage) ? serverMessage : FAILURE_MESSAGES.unavailable;
    return new ApiError(message, { status, code: "unavailable" });
  }
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
  if (PUBLIC_REQUEST_MESSAGES.has(error?.message)) return error.message;
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
      const retryAfterSeconds = readRetryAfter(response, payload);
      if (retryAfterSeconds) error.retryAfterSeconds = retryAfterSeconds;
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
    async uploadFile(path, file, { category, description } = {}) {
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/octet-stream",
        "X-Medchain-Filename": encodeURIComponent(file.name),
        "X-Medchain-Category": category,
      };
      if (description) headers["X-Medchain-Description"] = encodeURIComponent(description);
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      let response;
      try {
        response = await fetchImpl(`${resolveBase(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`, {
          method: "POST",
          headers,
          body: file,
          signal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        if (error?.name === "TimeoutError" || error?.name === "AbortError") {
          throw new ApiError(REQUEST_MESSAGES.timeout, { status: 0, code: "timeout" });
        }
        throw new ApiError(FAILURE_MESSAGES.network, { status: 0, code: "network" });
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401 && accessToken) onUnauthorized?.();
        throw errorForStatus(response.status, payload?.error || "");
      }
      if (!payload) throw new ApiError(REQUEST_MESSAGES.server, { status: response.status, code: "server" });
      return payload;
    },
    async download(path) {
      const headers = { Accept: "application/pdf, image/png, image/jpeg" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetchImpl(`${resolveBase(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`, { headers });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw errorForStatus(response.status, payload?.error || "");
      }
      return response.blob();
    },
    async changePassword({ currentPassword, newPassword }) {
      return request("/auth/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
    },
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
