import { useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/api";
import { patientWalletChanged, readPatientSession, readSession, sessionFromProfile } from "../lib/roles";
import { AuthContext } from "./auth-context";

const EXPIRED_NOTICE = "Your session has ended. Sign in again.";
const SIGNED_OUT_NOTICE =
  "You are signed out on this browser. The server does not revoke the token. It expires 15 minutes after it was issued.";

const WALLET_CHANGED_NOTICE = "The connected wallet changed. Sign in again with the patient wallet.";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
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
    let active = true;
    apiClient.restoreSession().then((payload) => {
      if (!active) return;
      setUser((current) => current ?? sessionFromProfile(payload));
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user || user.role !== "patient") return undefined;
    const ethereum = globalThis.window?.ethereum;
    if (!ethereum?.on) return undefined;
    const onAccounts = (accounts) => {
      if (!patientWalletChanged(user.walletAddress, accounts)) return;
      apiClient.request("/auth/session-end", { method: "POST", body: {} }).catch(() => {});
      apiClient.setAccessToken(null);
      setUser(null);
      setNotice(WALLET_CHANGED_NOTICE);
    };
    ethereum.on("accountsChanged", onAccounts);
    return () => ethereum.removeListener?.("accountsChanged", onAccounts);
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const timer = window.setTimeout(() => {
      const ending = apiClient.request("/auth/session-end", { method: "POST", body: {} }).catch(() => {});
      apiClient.setAccessToken(null);
      setUser(null);
      setNotice(EXPIRED_NOTICE);
      void ending;
    }, Math.max(0, user.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
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
          body: { nonce: challenge.nonce, signature, patientId },
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
      async logout(notice = SIGNED_OUT_NOTICE) {
        try {
          await apiClient.request("/auth/session-end", { method: "POST", body: {} });
        } catch {
          /* The browser session ends even when the audit request cannot be stored. */
        }
        apiClient.setAccessToken(null);
        setUser(null);
        setNotice(typeof notice === "string" && notice ? notice : SIGNED_OUT_NOTICE);
      },
    }),
    [user, notice, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
