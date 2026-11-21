import { apiClient } from "../lib/api.js";

export const nursingService = {
  create(patientId, body) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/nursing-intake`, { method: "POST", body });
  },
  list(patientId) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/nursing-intake`);
  },
  summary(patientId) {
    return apiClient.request(`/patients/${encodeURIComponent(patientId)}/staff-summary`);
  },
  queue() {
    return apiClient.request("/nursing/queue");
  },
  review(id, body) {
    return apiClient.request(`/nursing-intake/${encodeURIComponent(id)}/review`, { method: "POST", body });
  },
};
