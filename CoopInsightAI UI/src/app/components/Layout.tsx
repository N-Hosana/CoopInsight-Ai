import { Outlet, Link, useLocation, useNavigate } from "react-router";
import { LayoutDashboard, Users, UserCircle, Activity, FileText, WifiOff, Wifi, BarChart3, ShieldCheck, CreditCard, Settings, LogOut, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

const navigation = [
  { name: "Dashboard", path: "/", icon: LayoutDashboard },
  { name: "Cooperatives", path: "/cooperatives", icon: Users },
  { name: "Members", path: "/members", icon: UserCircle },
  { name: "Activities", path: "/activities", icon: Activity },
  { name: "Record Transaction", path: "/record-transaction", icon: CreditCard },
  { name: "AI Insights", path: "/ai-insights", icon: BarChart3 },
  { name: "RCA Monitoring", path: "/government-monitoring", icon: ShieldCheck },
  { name: "Reports", path: "/reports", icon: FileText },
];

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isActive = (path: string) => {
    if (path === "/") {
      return location.pathname === "/";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-[#F5F1E8]">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-[#1B4332] border-r border-[#2D6A4F]">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-[#D4A574]">CoopInsightAI</h1>
          <p className="text-sm text-[#B8956A] mt-1">Intelligence Platform</p>
        </div>

        <nav className="px-4 space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  active
                    ? "bg-[#2D6A4F] text-[#D4A574]"
                    : "text-[#B8C5BD] hover:bg-[#2D6A4F]/50"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="ml-64">
        {/* Top Navigation Bar */}
        <header className="bg-white border-b border-[#D4A574]/30 sticky top-0 z-10">
          <div className="px-8 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isOnline ? (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <Wifi className="w-4 h-4" />
                  <span>Online</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-600 text-sm">
                  <WifiOff className="w-4 h-4" />
                  <span>Offline Mode</span>
                </div>
              )}
            </div>
            
            {/* User Profile Section */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center gap-3 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors"
              >
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{user?.name || "User"}</p>
                  <p className="text-xs text-gray-500 capitalize">{user?.role || ""}</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-[#2D6A4F] flex items-center justify-center text-white font-medium text-sm">
                  {user?.name ? user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() : "U"}
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>

              {showProfileMenu && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 z-50">
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-[#2D6A4F] flex items-center justify-center text-white font-semibold">
                        {user?.name ? user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() : "U"}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{user?.name}</p>
                        <p className="text-sm text-gray-500">{user?.email}</p>
                        <span className="inline-block mt-1 px-2 py-0.5 bg-[#2D6A4F]/10 text-[#2D6A4F] text-xs rounded-full capitalize">{user?.role}</span>
                      </div>
                    </div>
                    {user?.phone && <p className="text-xs text-gray-500 mt-2">{user.phone}</p>}
                    {user?.cooperativeName && <p className="text-xs text-gray-500">{user.cooperativeName}</p>}
                  </div>
                  <div className="p-2">
                    <button
                      onClick={() => { setShowProfileMenu(false); navigate("/settings"); }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm text-gray-700"
                    >
                      <Settings className="w-4 h-4" />
                      View & Edit Profile
                    </button>
                    <button
                      onClick={() => { logout(); navigate("/login"); }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-50 text-sm text-red-600"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
