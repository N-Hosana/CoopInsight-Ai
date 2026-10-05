import { BrowserRouter, Routes, Route, Link, Outlet, useLocation, Navigate, useNavigate } from "react-router";
import {
  LayoutDashboard,
  Users,
  UserCircle,
  Activity,
  FileText,
  WifiOff,
  Wifi,
  LogOut,
  DollarSign,
  Brain,
  Building2,
  Bell as BellIcon,
  Plug,
  Shield,
  Settings as SettingsIcon,
  RefreshCw,
  MessageSquare,
  Menu,
  X,
  ChevronDown,
  BadgeCheck,
  Stethoscope,
  HandCoins,
  FileSignature,
  IdCard,
  ClipboardList,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthProvider, describeRole, useAuth } from "./contexts/AuthContext";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { EmailVerification } from "./pages/EmailVerification";
import { ForgotPassword } from "./pages/ForgotPassword";
import { Dashboard } from "./pages/Dashboard";
import { Cooperatives } from "./pages/Cooperatives";
import { Members } from "./pages/Members";
import { Activities } from "./pages/Activities";
import { Reports } from "./pages/Reports";
import { Financials } from "./pages/Financials";
import { BudgetPlanning } from "./pages/BudgetPlanning";
import { AIInsights } from "./pages/AIInsights";
import { GovernmentMonitoring } from "./pages/GovernmentMonitoring";
import { Notifications } from "./pages/Notifications";
import { Integrations } from "./pages/Integrations";
import { SecurityAudit } from "./pages/SecurityAudit";
import { Settings } from "./pages/Settings";
import { Messages } from "./pages/Messages";
import { AddMember } from "./pages/AddMember";
import { CreateActivity } from "./pages/CreateActivity";
import { RecordTransaction } from "./pages/RecordTransaction";
import { RecordContributions } from "./pages/RecordContributions";
import { BalanceSheetEntry } from "./pages/BalanceSheetEntry";
import { Records } from "./pages/Records";
import { MemberDetails } from "./pages/MemberDetails";
import { TransactionDetails } from "./pages/TransactionDetails";
import { FinancialSummary } from "./pages/FinancialSummary";
import { ActivityDetails } from "./pages/ActivityDetails";
import { AIInsightDetail } from "./pages/AIInsightDetail";
import { CooperativeProfile } from "./pages/CooperativeProfile";
import { CooperativeDocuments } from "./pages/CooperativeDocuments";
import { Permits } from "./pages/Permits";
import { MonthlyAudit } from "./pages/MonthlyAudit";
import { Funding } from "./pages/Funding";
import { RcaServices } from "./pages/RcaServices";
import { NotificationBar } from "./components/NotificationBar";

function ProfileDropdown() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "U";

  return (
    <div className="flex items-center gap-4">
      <NotificationBar />
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 hover:bg-accent rounded-lg px-2 py-1 transition-colors"
        >
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-card-foreground">{user?.name}</p>
            <p className="text-xs text-muted-foreground">{describeRole(user ?? null)}</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-medium cursor-pointer">
            {initials}
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-2 w-72 bg-card rounded-xl shadow-lg border border-border z-50">
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-lg">
                  {initials}
                </div>
                <div>
                  <p className="font-semibold text-card-foreground">{user?.name}</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                  <span className="inline-block mt-1 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">{describeRole(user ?? null)}</span>
                </div>
              </div>
              {user?.phone && <p className="text-xs text-muted-foreground mt-2">{user.phone}</p>}
              {user?.cooperativeName && <p className="text-xs text-muted-foreground">{user.cooperativeName}</p>}
            </div>
            <div className="p-2">
              <button
                onClick={() => { setOpen(false); navigate("/settings"); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent text-sm text-card-foreground"
              >
                <SettingsIcon className="w-4 h-4" />
                View & Edit Profile
              </button>
              <button
                onClick={() => { logout(); navigate("/login"); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-destructive/10 text-sm text-destructive"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SIDEBAR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Grouped, because a flat list of twenty-two links is not navigation — it is a
 * pile. Each group answers one question:
 *
 *   Overview     where am I
 *   My cooperative   the things a cooperative does for itself
 *   Oversight    the things an officer does to cooperatives
 *   RCA          asking the agency for something, and what it licenses
 *   Admin        the platform itself
 *
 * SECURITY & AUDIT is admin-only. It was previously offered to every
 * `government` account, which meant sector, district and RCA officers all saw a
 * menu item whose every request the server answers with 403 — a link that
 * exists only to fail. The backend has always restricted it to administrators;
 * the sidebar now agrees with the backend, and `RoleRoute` below stops anyone
 * reaching it by typing the URL.
 */
type NavRole = "admin" | "manager" | "member" | "government" | "generalManager";

interface NavigationItem {
  name: string;
  path: string;
  icon: typeof LayoutDashboard;
  roles: NavRole[];
  group: string;
  requireCooperative?: boolean;
  /** Restricts an item to particular tiers of the oversight chain. */
  oversightLevels?: Array<"sector" | "district" | "rca">;
}

/** Who may open the security console. Mirrors the backend's `authorize` list. */
export const SECURITY_ROLES = ["admin", "generalManager"];

const NAV_GROUPS = ["Overview", "My cooperative", "Oversight", "RCA", "Admin"];

const getNavigationForUser = (
  user: { role: string; cooperativeId?: string; oversightLevel?: string | null } | null
) => {
  const allNavigation: NavigationItem[] = [
    // ── Overview ──────────────────────────────────────────────────────────
    { name: "Dashboard", path: "/", icon: LayoutDashboard, group: "Overview", roles: ["admin", "manager", "member", "government", "generalManager"] },
    { name: "Messages", path: "/messages", icon: MessageSquare, group: "Overview", roles: ["admin", "manager", "member", "government", "generalManager"] },
    { name: "Notifications", path: "/notifications", icon: BellIcon, group: "Overview", roles: ["admin", "manager", "member", "government", "generalManager"] },

    // ── My cooperative ────────────────────────────────────────────────────
    { name: "Cooperative Profile", path: "/cooperative-profile", icon: Building2, group: "My cooperative", roles: ["manager", "member"], requireCooperative: true },
    // Everything the oversight officers and the audit see comes from these
    // records; this is where the manager sees which are going stale.
    { name: "Records", path: "/records", icon: ClipboardList, group: "My cooperative", roles: ["manager"], requireCooperative: true },
    // Administrators keep records for any cooperative, choosing it on the page.
    { name: "Record keeping", path: "/records", icon: ClipboardList, group: "Admin", roles: ["admin", "generalManager"] },
    // Every member, attached or not: a member who has left still reads their
    // own history, and hiding this when the cooperative link was cleared is how
    // a member lost sight of their savings and activity.
    { name: "My Record", path: "/members/me", icon: IdCard, group: "My cooperative", roles: ["member"] },
    { name: "Members", path: "/members", icon: UserCircle, group: "My cooperative", roles: ["admin", "manager", "generalManager"] },
    { name: "Activities", path: "/activities", icon: Activity, group: "My cooperative", roles: ["manager", "member", "generalManager"] },
    { name: "Financials", path: "/financials", icon: DollarSign, group: "My cooperative", roles: ["admin", "manager", "member", "government", "generalManager"] },
    { name: "Documents", path: "/cooperative-documents", icon: FileText, group: "My cooperative", roles: ["manager", "member"] },

    // ── Oversight ─────────────────────────────────────────────────────────
    { name: "Cooperative register", path: "/cooperatives", icon: Users, group: "Oversight", roles: ["admin", "manager", "government", "generalManager"] },
    { name: "District monitoring", path: "/government-monitoring", icon: Building2, group: "Oversight", roles: ["government", "admin", "generalManager"] },
    { name: "Monthly audit", path: "/monthly-audit", icon: Stethoscope, group: "Oversight", roles: ["government", "admin", "generalManager"] },
    { name: "Cooperative documents", path: "/cooperative-documents", icon: FileText, group: "Oversight", roles: ["admin", "government", "generalManager"] },
    { name: "Reports", path: "/reports", icon: FileText, group: "Oversight", roles: ["admin", "manager", "government", "generalManager"] },
    { name: "AI insights", path: "/ai-insights", icon: Brain, group: "Oversight", roles: ["admin", "manager", "member", "generalManager"] },

    // ── RCA ───────────────────────────────────────────────────────────────
    // Formation, dissolution and the four certificate services are one page
    // with tabs. They were two, which left a president guessing which of them
    // held the form they needed.
    { name: "Services & requests", path: "/rca-services", icon: FileSignature, group: "RCA", roles: ["member", "manager", "admin", "generalManager", "government"] },
    { name: "Operating permits", path: "/permits", icon: BadgeCheck, group: "RCA", roles: ["government", "admin", "generalManager", "manager", "member"] },
    { name: "External support", path: "/funding", icon: HandCoins, group: "RCA", roles: ["government", "admin", "generalManager", "manager", "member"] },

    // ── Admin ─────────────────────────────────────────────────────────────
    { name: "Integrations", path: "/integrations", icon: Plug, group: "Admin", roles: ["admin", "generalManager"] },
    { name: "Security & audit", path: "/security-audit", icon: Shield, group: "Admin", roles: SECURITY_ROLES as NavRole[] },
  ];

  return allNavigation.filter((item) => {
    if (!user) return false;
    if (!item.roles.includes(user.role as NavRole)) return false;
    if (item.requireCooperative && !user.cooperativeId) return false;
    if (item.oversightLevels) {
      const level = user.oversightLevel as "sector" | "district" | "rca" | null | undefined;
      if (!level || !item.oversightLevels.includes(level)) return false;
    }
    return true;
  });
};

function Layout() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { lastSyncTime } = useTheme();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const isActive = (path: string) => {
    if (path === "/") {
      return location.pathname === "/";
    }
    return location.pathname.startsWith(path);
  };

  const navigation = getNavigationForUser(user || null);

  const getFormattedSyncTime = () => {
    if (!lastSyncTime) return "";
    const date = new Date(lastSyncTime);
    return date.toLocaleTimeString("en-RW", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="min-h-screen bg-background md:flex">
      {/* Mobile sidebar overlay */}
      <div
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity duration-200 md:hidden ${sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={() => setSidebarOpen(false)}
      />
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between p-6 border-b border-sidebar-border md:hidden">
          <div>
            <h1 className="text-2xl font-bold text-secondary">CoopInsightAI</h1>
            <p className="text-sm text-sidebar-foreground/80 mt-1">Gasabo District</p>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-lg bg-slate-100 text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="hidden md:block p-6 border-b border-sidebar-border">
          <h1 className="text-2xl font-bold text-secondary">CoopInsightAI</h1>
          <p className="text-sm text-sidebar-foreground/80 mt-1">Gasabo District</p>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 scrollbar-hidden">
          {NAV_GROUPS.map((group) => {
            const items = navigation.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <div key={group}>
                <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {group}
                </p>
                <div className="space-y-1">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.path);

                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
                          active
                            ? "bg-[#2D6A4F] text-white"
                            : "text-sidebar-foreground hover:bg-sidebar-accent"
                        }`}
                      >
                        <Icon className="w-5 h-5 flex-shrink-0" />
                        <span className="text-sm">{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Settings and Logout */}
        <div className="mt-auto p-4 bg-sidebar border-t border-sidebar-border space-y-2">
          <Link
            to="/settings"
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <SettingsIcon className="w-5 h-5" />
            <span>Settings</span>
          </Link>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-screen flex-col transition-all duration-200">
        {/* Top Navigation Bar */}
        <header className="bg-card border-b border-border sticky top-0 z-10 shadow-sm">
          <div className="px-4 py-4 flex items-center justify-between md:px-8">
            <div className="flex items-center gap-4">
              <button
                className="inline-flex items-center justify-center rounded-lg border border-border bg-card p-2 text-card-foreground md:hidden"
                onClick={() => setSidebarOpen((open) => !open)}
              >
                <Menu className="w-5 h-5" />
              </button>
              {isOnline ? (
                <div className="flex items-center gap-2 text-primary text-sm">
                  <Wifi className="w-4 h-4" />
                  <span>Online</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <WifiOff className="w-4 h-4" />
                  <span>Offline</span>
                </div>
              )}
              {lastSyncTime && (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <RefreshCw className="w-3 h-3" />
                  <span>Last synced: {getFormattedSyncTime()}</span>
                </div>
              )}
            </div>

            {/* User Profile and Notifications */}
            <ProfileDropdown />
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 min-h-0 overflow-x-auto overflow-y-auto p-4 md:p-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

// Protected Route Component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

/**
 * Redirects to `to`, carrying the query string across.
 *
 * `<Navigate>` drops it, which for the cooperative-profile redirect would mean
 * every "View details" link landing on the page with no cooperative selected.
 */
function RedirectKeepingQuery({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

function RoleRoute({ roles, requireCooperative, children }: { roles: Array<string>; requireCooperative?: boolean; children: React.ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (requireCooperative && !user.cooperativeId) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/email-verification" element={<EmailVerification />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="cooperatives" element={<Cooperatives />} />
        <Route path="members" element={<Members />} />
        <Route path="members/new" element={<AddMember />} />
        <Route path="members/:id" element={<MemberDetails />} />
        <Route path="activities" element={<Activities />} />
        <Route path="activities/new" element={<CreateActivity />} />
        <Route path="activities/:id" element={<ActivityDetails />} />
        <Route
          path="financials"
          element={
            <RoleRoute roles={["admin", "manager", "member", "government", "generalManager"]}>
              <Financials />
            </RoleRoute>
          }
        />
        <Route
          path="financials/budget-planning"
          element={
            <RoleRoute roles={["admin", "manager", "generalManager"]}>
              <BudgetPlanning />
            </RoleRoute>
          }
        />
        <Route
          path="financials/summary"
          element={
            <RoleRoute roles={["admin", "manager", "member", "government", "generalManager"]}>
              <FinancialSummary />
            </RoleRoute>
          }
        />
        <Route path="transactions/new" element={<RecordTransaction />} />
        <Route
          path="records"
          element={
            <RoleRoute roles={["manager", "admin", "generalManager"]}>
              <Records />
            </RoleRoute>
          }
        />
        <Route
          path="contributions/new"
          element={
            <RoleRoute roles={["manager", "admin", "generalManager"]}>
              <RecordContributions />
            </RoleRoute>
          }
        />
        <Route
          path="balance-sheets/new"
          element={
            <RoleRoute roles={["manager", "admin", "generalManager"]}>
              <BalanceSheetEntry />
            </RoleRoute>
          }
        />
        <Route path="transactions/:id" element={<TransactionDetails />} />
        <Route path="ai-insights" element={<AIInsights />} />
        <Route path="ai-insights/:id" element={<AIInsightDetail />} />
        <Route path="government-monitoring" element={<GovernmentMonitoring />} />
        <Route path="reports" element={<Reports />} />
        {/*
          One cooperative profile page, not two. /cooperatives/profile?id=… and
          /cooperative-profile rendered the identical component from different
          paths, so a fix applied to one was still missing from the other. This
          is now the only one; the old path redirects, keeping its ?id=.
        */}
        <Route
          path="cooperative-profile"
          element={
            <RoleRoute roles={["admin", "manager", "member", "government", "generalManager"]}>
              <CooperativeProfile />
            </RoleRoute>
          }
        />
        <Route path="cooperatives/profile" element={<RedirectKeepingQuery to="/cooperative-profile" />} />
        <Route
          path="cooperative-documents"
          element={
            <RoleRoute roles={["manager", "member", "government", "admin", "generalManager"]}>
              <CooperativeDocuments />
            </RoleRoute>
          }
        />
        {/*
          Leaving a cooperative is now a tab of Services & requests — it is a
          formal request like the others, it just happens to be decided by the
          general assembly rather than by the RCA. The old path is kept as a
          redirect because notifications already sitting in people's inboxes
          link to it, and it carries the tab so those links still land on the
          right panel.
        */}
        <Route path="membership" element={<Navigate to="/rca-services?tab=membership" replace />} />
        {/*
          Formation, dissolution and the certificate services all live on
          /rca-services now. The old path is kept as a redirect rather than
          deleted, because it is in notification links already sitting in
          people's inboxes.
        */}
        <Route path="cooperative-requests" element={<Navigate to="/rca-services" replace />} />
        {/*
          The league table is a tab of District Monitoring now — it answers the
          same question that page exists for. The old path redirects so links
          already in notifications and bookmarks land on the right tab.
        */}
        <Route
          path="rankings"
          element={<Navigate to="/government-monitoring?tab=league" replace />}
        />
        <Route
          path="monthly-audit"
          element={
            <RoleRoute roles={["government", "admin", "generalManager"]}>
              <MonthlyAudit />
            </RoleRoute>
          }
        />
        <Route path="permits" element={<Permits />} />
        <Route path="funding" element={<Funding />} />
        <Route
          path="rca-services"
          element={
            <RoleRoute roles={["member", "manager", "admin", "generalManager", "government"]}>
              <RcaServices />
            </RoleRoute>
          }
        />
        <Route path="messages" element={<Messages />} />
        <Route path="notifications" element={<Notifications />} />
        <Route
          path="integrations"
          element={
            <RoleRoute roles={["admin", "generalManager"]}>
              <Integrations />
            </RoleRoute>
          }
        />
        {/*
          The security console reads every account's login history, the audit
          log and the anomaly queue. The backend restricts all of it to
          administrators; without this guard the page still rendered for anyone
          who typed the URL and simply filled with failed requests, which looks
          like a broken page rather than a closed door.
        */}
        <Route
          path="security-audit"
          element={
            <RoleRoute roles={SECURITY_ROLES}>
              <SecurityAudit />
            </RoleRoute>
          }
        />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <NotificationProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </NotificationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}