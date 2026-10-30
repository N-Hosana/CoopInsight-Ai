import { useAuth } from "../contexts/AuthContext";
import { MyInsights } from "../components/MyInsights";
import { ManagerInsights } from "../components/ManagerInsights";
import { OversightInsights } from "../components/OversightInsights";

/**
 * One page, three readers:
 *   a member     their own progress, and their own cooperative
 *   a manager    their own cooperative in plain language, and their own record
 *   an officer   every cooperative they supervise: a sector, the district, or all
 */
export function AIInsights() {
  const { user } = useAuth();
  if (user?.role === "member") return <MyInsights />;
  if (user?.role === "manager" || user?.role === "cooperative") return <ManagerInsights />;
  return <OversightInsights />;
}
