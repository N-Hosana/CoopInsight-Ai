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
  UserMinus,
  ClipboardCheck,
  Trophy,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
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
import { MemberDetails } from "./pages/MemberDetails";
import { TransactionDetails } from "./pages/TransactionDetails";
import { FinancialSummary } from "./pages/FinancialSummary";
import { ActivityDetails } from "./pages/ActivityDetails";
import { AIInsightDetail } from "./pages/AIInsightDetail";
import { CooperativeProfile } from "./pages/CooperativeProfile";
import { CooperativeDocuments } from "./pages/CooperativeDocuments";
import { Membership } from "./pages/Membership";
import { CooperativeRequests } from "./pages/CooperativeRequests";
import { CooperativeRankings } from "./pages/CooperativeRankings";
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
            <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
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
                  <span className="inline-block mt-1 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full capitalize">{user?.role}</span>
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

// Navigation items with role-based visibility
interface NavigationItem {
  name: string;
  path: string;
  icon: typeof LayoutDashboard;
  roles: Array<"admin" | "manager" | "member" | "government" | "generalManager">;
  requireCooperative?: boolean;
}

const getNavigationForUser = (user: { role: string; cooperativeId?: string } | null) => {
  const allNavigation: NavigationItem[] = [
    { name: "Dashboard", path: "/", icon: LayoutDashboard, roles: ["admin", "manager", "member", "government", "generalManager"] },
    { name: "Cooperatives", path: "/cooperatives", icon: Users, roles: ["admin", "manager", "government", "generalManager"] },
    { name: "Members", path: "/members", icon: UserCircle, roles: ["admin", "manager", "generalManager"] },
    { name: "Activities", path: "/activities", icon: Activity, roles: ["manager", "member", "generalManager"] },
    { name: "Messages", path: "/messages", icon: MessageSquare, roles: ["admin", "manager", "member", "government", "generalManager"] },
    { name: "Financials", path: "/financials", icon: DollarSign, roles: ["admin", "manager", "member", "government", "generalManager"] },
    { name: "AI Insights", path: "/ai-insights", icon: Brain, roles: ["admin", "manager", "member", "generalManager"] },
    { name: "Government Monitoring", path: "/government-monitoring", icon: Building2, roles: ["government", "admin", "generalManager"] },
    { name: "League Table", path: "/rankings", icon: Trophy, roles: ["government", "admin", "generalManager"] },
    { name: "Reports", path: "/reports", icon: FileText, roles: ["admin", "manager", "government", "generalManager"] },
    { name: "Cooperative Profile", path: "/cooperative-profile", icon: Building2, roles: ["manager", "member"], requireCooperative: true },
    { name: "Documents", path: "/cooperative-documents", icon: FileText, roles: ["manager", "member", "government"] },
    { name: "Membership", path: "/membership", icon: UserMinus, roles: ["member", "manager", "admin", "generalManager"] },
    { name: "Cooperative Requests", path: "/cooperative-requests", icon: ClipboardCheck, roles: ["member", "manager", "admin", "government", "generalManager"] },
    { name: "Notifications", path: "/notifications", icon: BellIcon, roles: ["admin", "manager", "member", "government", "generalManager"] },
    { name: "Integrations", path: "/integrations", icon: Plug, roles: ["admin", "manager", "generalManager"] },
    { name: "Security & Audit", path: "/security-audit", icon: Shield, roles: ["admin", "government", "generalManager"] },
  ];

  return allNavigation.filter((item) => {
    if (!user) return false;
    if (!item.roles.includes(user.role as any)) return false;
    if (item.requireCooperative && !user.cooperativeId) return false;
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

        <nav className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-1 scrollbar-hidden">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  active
                    ? "bg-[#2D6A4F] text-white"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.name}</span>
              </Link>
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
        <Route path="transactions/:id" element={<TransactionDetails />} />
        <Route path="ai-insights" element={<AIInsights />} />
        <Route path="ai-insights/:id" element={<AIInsightDetail />} />
        <Route path="government-monitoring" element={<GovernmentMonitoring />} />
        <Route path="reports" element={<Reports />} />
        <Route
          path="cooperative-profile"
          element={
            <RoleRoute roles={["manager", "member"]} requireCooperative>
              <CooperativeProfile />
            </RoleRoute>
          }
        />
        <Route
          path="cooperatives/profile"
          element={
            <RoleRoute roles={["admin", "manager", "member", "government", "generalManager"]}>
              <CooperativeProfile />
            </RoleRoute>
          }
        />
        <Route
          path="cooperative-documents"
          element={
            <RoleRoute roles={["manager", "member", "government"]}>
              <CooperativeDocuments />
            </RoleRoute>
          }
        />
        <Route
          path="membership"
          element={
            <RoleRoute roles={["member", "manager", "admin", "generalManager"]}>
              <Membership />
            </RoleRoute>
          }
        />
        <Route path="cooperative-requests" element={<CooperativeRequests />} />
        <Route
          path="rankings"
          element={
            <RoleRoute roles={["government", "admin", "generalManager"]}>
              <CooperativeRankings />
            </RoleRoute>
          }
        />
        <Route path="messages" element={<Messages />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="security-audit" element={<SecurityAudit />} />
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