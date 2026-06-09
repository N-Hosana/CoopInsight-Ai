import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void | Promise<void>;
}

export function Card({ children, className = "", onClick }: CardProps) {
  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}
