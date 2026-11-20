import { useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/api";
import { readPatientSession, readSession } from "../lib/roles";
import { AuthContext } from "./auth-context";

const EXPIRED_NOTICE = "Your session has ended. Sign in again.";
const SIGNED_OUT_NOTICE =
  "You are signed out on this browser. The server does not revoke the token. It expires 15 minutes after it was issued.";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    apiClient.setUnauthorizedHandler(() => {
      apiClient.setAccessToken(null);
      setUser(null);
      setNotice(EXPIRED_NOTICE);
    });
    return () => apiClient.setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const timer = window.setTimeout(() => {
      apiClient.setAccessToken(null);
      setUser(null);
      setNotice(EXPIRED_NOTICE);
    }, Math.max(0, user.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading: false,
      notice,
      clearNotice() {
        setNotice("");
      },
      async login(email, password) {
        const token = await apiClient.login(email, password);
        const session = readSession(token);
        if (!session) {
          apiClient.setAccessToken(null);
          throw new ApiError("Sign-in could not be completed. Try again later.", { status: 502, code: "server" });
        }
        apiClient.setAccessToken(token);
        setNotice("");
        setUser(session);
        return session;
      },
      async loginPatient({ patientId, walletAddress, signMessage }) {
        const challenge = await apiClient.request("/patient-auth/challenge", {
          method: "POST",
          body: { patientId, walletAddress },
          authenticated: false,
        });
        const signature = await signMessage(challenge.message);
        const payload = await apiClient.request("/patient-auth/token", {
          method: "POST",
          body: { nonce: challenge.nonce, signature },
          authenticated: false,
        });
        const session = readPatientSession(payload?.token);
        if (!session) {
          apiClient.setAccessToken(null);
          throw new ApiError("Patient sign-in could not be completed. Try again later.", { status: 502, code: "server" });
        }
        apiClient.setAccessToken(payload.token);
        setNotice("");
        setUser(session);
        return session;
      },
      logout(notice = SIGNED_OUT_NOTICE) {
        apiClient.setAccessToken(null);
        setUser(null);
        setNotice(typeof notice === "string" && notice ? notice : SIGNED_OUT_NOTICE);
      },
    }),
    [user, notice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
