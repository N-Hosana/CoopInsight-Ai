import { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useAuth } from "../contexts/AuthContext";
import { Moon, Sun, Bell, Lock, User, Shield } from "lucide-react";

export function Settings() {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { user } = useAuth();

  const initialSettings = {
    emailNotifications: true,
    smsNotifications: true,
    pushNotifications: true,
    activityAlerts: true,
    financialAlerts: true,
    twoFactorAuth: false,
    language: "en",
  };

  const [settings, setSettings] = useState(() => {
    const stored = localStorage.getItem("coopinsight_settings");
    return stored ? JSON.parse(stored) : initialSettings;
  });

  useEffect(() => {
    localStorage.setItem("coopinsight_settings", JSON.stringify(settings));
  }, [settings]);

  const handleToggle = (key: keyof typeof initialSettings) => {
    setSettings((prev: typeof initialSettings) => ({ ...prev, [key]: !prev[key] }));
  };

  const [activeSection, setActiveSection] = useState<"appearance" | "notifications" | "security" | "profile">("appearance");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account preferences, security, and profile options</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-6">
        <aside className="bg-card rounded-xl border border-border p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-card-foreground mb-4">Settings Menu</h2>
          <div className="space-y-2">
            {[
              { key: "appearance", label: "Appearance", icon: isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" /> },
              { key: "notifications", label: "Notifications", icon: <Bell className="w-4 h-4" /> },
              { key: "security", label: "Security", icon: <Shield className="w-4 h-4" /> },
              { key: "profile", label: "Profile", icon: <User className="w-4 h-4" /> },
            ].map((section) => (
              <button
                key={section.key}
                onClick={() => setActiveSection(section.key as any)}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                  activeSection === section.key
                    ? "bg-[#2D6A4F] text-white"
                    : "text-card-foreground hover:bg-muted"
                }`}
              >
                {section.icon}
                <span className="text-sm font-medium">{section.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-6">
          {activeSection === "appearance" && (
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  {isDarkMode ? <Moon className="w-5 h-5 text-[#2D6A4F]" /> : <Sun className="w-5 h-5 text-[#2D6A4F]" />}
                  <h2 className="text-lg font-semibold text-card-foreground">Appearance</h2>
                </div>
                <button
                  onClick={toggleDarkMode}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    isDarkMode ? "bg-[#2D6A4F]" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isDarkMode ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">Toggle between light and dark mode to match your workspace environment.</p>
            </div>
          )}

          {activeSection === "notifications" && (
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-card-foreground mb-3 flex items-center gap-2">
                  <Bell className="w-5 h-5 text-[#2D6A4F]" />
                  Notification Preferences
                </h2>
                <p className="text-sm text-muted-foreground">Customize how you receive updates and alerts.</p>
              </div>
              <div className="space-y-4">
                {[
                  { key: "emailNotifications", label: "Email Notifications", description: "Receive updates via email" },
                  { key: "smsNotifications", label: "SMS Notifications", description: "Receive updates via SMS" },
                  { key: "pushNotifications", label: "In-App Notifications", description: "Receive updates inside the app" },
                ].map((option) => (
                  <div key={option.key} className="flex items-center justify-between p-4 bg-muted rounded-xl border border-border">
                    <div>
                      <p className="font-medium text-card-foreground">{option.label}</p>
                      <p className="text-sm text-muted-foreground">{option.description}</p>
                    </div>
                    <button
                      onClick={() => handleToggle(option.key as any)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        settings[option.key as keyof typeof settings] ? "bg-[#2D6A4F]" : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          settings[option.key as keyof typeof settings] ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="font-semibold text-gray-900 mb-2">Notification types</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    "Loan Reminders",
                    "Meeting Notifications",
                    "Compliance Alerts",
                    "Member Activity",
                    "Financial Updates",
                  ].map((type) => (
                    <div key={type} className="flex items-center justify-between p-3 rounded-xl border border-gray-200">
                      <span className="text-sm text-gray-700">{type}</span>
                      <button
                        onClick={() => handleToggle("pushNotifications")}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          settings.pushNotifications ? "bg-[#2D6A4F]" : "bg-gray-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            settings.pushNotifications ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeSection === "security" && (
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-6">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-5 h-5 text-[#2D6A4F]" />
                <h2 className="text-lg font-semibold text-card-foreground">Security Settings</h2>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl border border-gray-200 bg-muted">
                  <div>
                    <p className="font-medium text-card-foreground">Two-Factor Authentication</p>
                    <p className="text-sm text-muted-foreground">Add an extra security layer to your account.</p>
                  </div>
                  <button
                    onClick={() => handleToggle("twoFactorAuth")}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings.twoFactorAuth ? "bg-[#2D6A4F]" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        settings.twoFactorAuth ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
                <button className="w-full px-4 py-2 bg-[#2D6A4F] text-white rounded-xl hover:bg-[#1B4332] transition-colors text-sm font-medium flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" />
                  Change Password
                </button>
              </div>
            </div>
          )}

          {activeSection === "profile" && (
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-6">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-5 h-5 text-[#2D6A4F]" />
                <h2 className="text-lg font-semibold text-card-foreground">Profile Information</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Full Name</label>
                  <input
                    type="text"
                    value={user?.name || ""}
                    disabled
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Email</label>
                  <input
                    type="email"
                    value={user?.email || ""}
                    disabled
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Phone</label>
                  <input
                    type="tel"
                    value={user?.phone || ""}
                    disabled
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Role</label>
                  <input
                    type="text"
                    value={user?.role || ""}
                    disabled
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground capitalize"
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
