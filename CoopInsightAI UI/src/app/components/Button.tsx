import { ReactNode, ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Button({ 
  children, 
  variant = "primary",
  size = "md",
  className = "", 
  ...props 
}: ButtonProps) {
  const baseStyles = "rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  
  const sizeStyles = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2",
    lg: "px-6 py-3",
  };

  const variantStyles = {
    primary: "bg-[#2D6A4F] text-white hover:bg-[#1B4332]",
    secondary: "bg-[#D4A574] text-[#1B4332] hover:bg-[#B8956A]",
    danger: "bg-red-600 text-white hover:bg-red-700",
    outline: "border border-border bg-transparent text-foreground hover:bg-muted",
  };

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
