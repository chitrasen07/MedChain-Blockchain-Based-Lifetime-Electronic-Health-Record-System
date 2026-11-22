import { useEffect, useState } from "react";
import { ApiError, apiClient, messageForRequest } from "./api";
import { appointmentNotice } from "./appointments";

const SEEN_KEY = "medchain.appointment-status";

function readSeen() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SEEN_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function remember(appointments) {
  const seen = readSeen();
  const notices = [];
  const next = { ...seen };
  for (const item of appointments) {
    const text = appointmentNotice(seen[item.id], item);
    if (text) notices.push({ id: item.id, text, appointment: item });
    next[item.id] = item.status;
  }
  sessionStorage.setItem(SEEN_KEY, JSON.stringify(next));
  return notices;
}

export function useAppointmentFeed(path, { notify = false } = {}) {
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState(null);
  const [state, setState] = useState({ phase: "loading", data: null, message: "" });

  useEffect(() => {
    let active = true;
    apiClient.request(path).then(
      (data) => {
        if (!active) return;
        if (notify && Array.isArray(data?.appointments)) {
          const notices = remember(data.appointments);
          if (notices[0]) setNotice(notices[0]);
        }
        setState({ phase: "ready", data, message: "" });
      },
      (error) => {
        if (!active) return;
        const message = error instanceof ApiError ? messageForRequest(error) : "The appointment list could not be loaded.";
        setState((current) => ({
          phase: current.data ? "ready" : "error",
          data: current.data,
          message,
        }));
      },
    );
    return () => {
      active = false;
    };
  }, [notify, path, tick]);

  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(refresh, 12000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { ...state, notice, refresh: () => setTick((value) => value + 1) };
}
