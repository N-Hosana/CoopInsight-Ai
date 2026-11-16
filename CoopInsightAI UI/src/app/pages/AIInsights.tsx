import { useAuth } from "../contexts/AuthContext";
import { MyInsights } from "../components/MyInsights";
import { ManagerInsights } from "../components/ManagerInsights";
import { OversightInsights } from "../components/OversightInsights";

/**
 * One page, three readers:
 *   a member     their own progress, and their own cooperative
 *   a manager    their cooperative, its members, their own record, and the AI audit
 *   an officer   the cooperatives they supervise, and the AI audit
 *
 * `?view=audit` opens the AI audit tab (old Monthly audit links land there).
 */
export function AIInsights() {
  const { user } = useAuth();
  if (user?.role === "member") return <MyInsights />;
  if (user?.role === "manager" || user?.role === "cooperative") return <ManagerInsights />;
  return <OversightInsights />;
}
