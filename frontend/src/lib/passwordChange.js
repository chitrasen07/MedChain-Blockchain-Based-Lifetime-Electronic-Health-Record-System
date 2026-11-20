export const WEAK_PASSWORD = "Use at least 12 characters with a letter and a number.";
export const REUSED_PASSWORD = "Choose a password that is different from the current password.";
export const CURRENT_PASSWORD = "The current password was not accepted.";

export function passwordProblems({ currentPassword, newPassword, confirmPassword }) {
  const problems = { currentPassword: "", newPassword: "", confirmPassword: "" };
  if (!currentPassword) problems.currentPassword = "Enter your current password.";
  if (!newPassword) problems.newPassword = "Enter a new password.";
  else if (newPassword.length < 12 || newPassword.length > 128 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    problems.newPassword = WEAK_PASSWORD;
  } else if (newPassword === currentPassword) problems.newPassword = REUSED_PASSWORD;
  if (!confirmPassword) problems.confirmPassword = "Confirm the new password.";
  else if (newPassword && confirmPassword !== newPassword) problems.confirmPassword = "The confirmation does not match the new password.";
  return problems;
}

export function passwordStrength(password) {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[A-Za-z]/.test(password) && /[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const label = score <= 1 ? "Weak" : score === 2 ? "Fair" : "Strong";
  return { score, label };
}
