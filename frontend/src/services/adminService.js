import { apiClient } from "../lib/api.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const STAFF_CREATE_ROLES = ["receptionist", "doctor", "reviewer", "hospital_staff"];

export function validateStaffAccount(input) {
  const errors = {};
  const email = input.email.trim();
  if (!emailPattern.test(email) || email.length > 320) errors.email = "Enter a valid work email.";
  if (input.password.length < 12) errors.password = "Use at least 12 characters.";
  if (!STAFF_CREATE_ROLES.includes(input.role)) errors.role = "Choose receptionist, doctor, reviewer, or hospital staff.";
  return { errors, body: { email, password: input.password, role: input.role } };
}

export function createAdminService(client = apiClient) {
  return {
    listUsers() {
      return client.request("/admin/users");
    },
    createUser(body) {
      return client.request("/admin/users", { method: "POST", body });
    },
    disableUser(id) {
      return client.request(`/admin/users/${encodeURIComponent(id)}/disable`, { method: "POST" });
    },
  };
}

export const adminService = createAdminService();
