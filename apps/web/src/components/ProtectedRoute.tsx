import { Navigate, useLocation } from "react-router-dom";
import { useAuth, type Role } from "../auth/AuthContext";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  requireRole?: Role;
}

export function ProtectedRoute({ children, requireRole }: Props) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (requireRole && user.role !== requireRole) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
