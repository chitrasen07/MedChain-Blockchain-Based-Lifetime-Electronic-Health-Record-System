export function VerificationNotice({ children }) {
  return (
    <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-warning">
      {children}
    </p>
  );
}
