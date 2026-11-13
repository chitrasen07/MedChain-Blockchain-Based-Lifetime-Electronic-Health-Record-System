import { LoaderCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "../lib/cn";

const variants = {
  primary: "bg-teal text-white hover:bg-teal-dark",
  secondary: "border border-line bg-surface text-navy hover:bg-canvas",
  ghost: "text-navy hover:bg-navy/5",
  danger: "bg-danger text-white hover:bg-[#7f2424]",
};

const sizes = {
  sm: "h-10 min-h-10 px-3 text-sm",
  md: "h-11 min-h-11 px-4 text-sm",
  lg: "h-12 min-h-12 px-5 text-[15px]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  to,
  ...props
}) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    variants[variant],
    sizes[size],
    className,
  );

  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
