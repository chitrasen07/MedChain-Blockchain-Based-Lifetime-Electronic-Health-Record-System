const WEAK_PASSWORD = "Use at least 12 characters with a letter and a number.";
const REUSED_PASSWORD = "Choose a password that is different from the current password.";
const CURRENT_PASSWORD = "The current password was not accepted.";

function passwordChangeMessage(currentPassword, newPassword) {
  if (typeof currentPassword !== "string" || currentPassword.length < 1 || currentPassword.length > 128) return CURRENT_PASSWORD;
  if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 128) return WEAK_PASSWORD;
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) return WEAK_PASSWORD;
  if (newPassword === currentPassword) return REUSED_PASSWORD;
  return "";
}

module.exports = { passwordChangeMessage, WEAK_PASSWORD, REUSED_PASSWORD, CURRENT_PASSWORD };
