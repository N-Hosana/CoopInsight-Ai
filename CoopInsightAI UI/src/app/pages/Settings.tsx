import { useState, useEffect, useCallback } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useAuth } from "../contexts/AuthContext";
import { Moon, Sun, Bell, Lock, User, Shield } from "lucide-react";
import { api } from "../services/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileData {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  [key: string]: any;
}

interface AppearanceData {
  darkMode?: boolean;
  language?: string;
  [key: string]: any;
}

interface NotificationsData {
  emailNotifications?: boolean;
  smsNotifications?: boolean;
  inAppNotifications?: boolean;
  loanDueReminders?: boolean;
  activityReminders?: boolean;
  monthlyReports?: boolean;
  complianceAlerts?: boolean;
  newMemberAlerts?: boolean;
  loginNotifications?: boolean;
  [key: string]: any;
}

interface SecurityData {
  twoFactorAuth?: boolean;
  [key: string]: any;
}

interface SettingsPayload {
  profile?: ProfileData;
  appearance?: AppearanceData;
  notifications?: NotificationsData;
  security?: SecurityData;
  privacy?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Toast helper
// ---------------------------------------------------------------------------

function useToast() {
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const show = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  return { toast, show };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Settings() {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { user } = useAuth();
  const { toast, show: showToast } = useToast();

  // Remote settings state
  const [loadingSettings, setLoadingSettings] = useState(true);

  // Profile section
  const [profile, setProfile] = useState<ProfileData>({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    role: user?.role ?? "",
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // Appearance section
  const [language, setLanguage] = useState("en");
  const [savingAppearance, setSavingAppearance] = useState(false);

  // Notifications section
  const [notifications, setNotifications] = useState<NotificationsData>({
    emailNotifications: true,
    smsNotifications: true,
    inAppNotifications: true,
    loanDueReminders: true,
    activityReminders: true,
    monthlyReports: true,
    complianceAlerts: true,
    newMemberAlerts: false,
    loginNotifications: true,
  });
  const [savingNotifications, setSavingNotifications] = useState(false);

  // Security section
  const [twoFactorAuth, setTwoFactorAuth] = useState(false);
  const [twoFactorStep, setTwoFactorStep] = useState<"idle" | "awaiting-otp" | "awaiting-password">("idle");
  const [twoFactorOtp, setTwoFactorOtp] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [activeSection, setActiveSection] = useState<"appearance" | "notifications" | "security" | "profile">("appearance");

  // ---------------------------------------------------------------------------
  // Load settings on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const fetchSettings = async () => {
      setLoadingSettings(true);
      try {
        const data = await api.get<{ data: SettingsPayload }>("/settings");
        const s = data.data ?? {};

        if (s.profile) {
          setProfile((prev) => ({ ...prev, ...s.profile }));
        }
        if (s.appearance) {
          setLanguage(s.appearance.language ?? "en");
        }
        if (s.notifications) {
          setNotifications((prev) => ({ ...prev, ...s.notifications }));
        }
        if (s.security) {
          setTwoFactorAuth((s.security as any).twoFactorEnabled ?? s.security.twoFactorAuth ?? false);
        }
      } catch {
        // Non-fatal: fall back to defaults / auth context values
      } finally {
        setLoadingSettings(false);
      }
    };
    fetchSettings();
  }, []);

  // ---------------------------------------------------------------------------
  // Save handlers
  // ---------------------------------------------------------------------------

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      await api.patch("/settings/profile", profile);
      showToast("Profile updated successfully.");
    } catch (err: any) {
      showToast(err?.message ?? "Failed to update profile.", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveAppearance = async () => {
    setSavingAppearance(true);
    try {
      await api.patch("/settings/appearance", { darkMode: isDarkMode, language });
      showToast("Appearance settings saved.");
    } catch (err: any) {
      showToast(err?.message ?? "Failed to save appearance settings.", "error");
    } finally {
      setSavingAppearance(false);
    }
  };

  const handleSaveNotifications = async () => {
    setSavingNotifications(true);
    try {
      await api.patch("/settings/notifications", notifications);
      showToast("Notification preferences saved.");
    } catch (err: any) {
      showToast(err?.message ?? "Failed to save notification preferences.", "error");
    } finally {
      setSavingNotifications(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      showToast("Please fill in all password fields.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match.", "error");
      return;
    }
    setSavingPassword(true);
    try {
      await api.patch("/settings/change-password", { currentPassword, newPassword });
      showToast("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      showToast(err?.message ?? "Failed to change password.", "error");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleToggleNotification = (key: keyof NotificationsData) => {
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStartEnableTwoFactor = async () => {
    setTwoFactorLoading(true);
    try {
      await api.post("/settings/two-factor/enable", {});
      setTwoFactorStep("awaiting-otp");
      showToast("A verification code has been sent to confirm 2FA setup.");
    } catch (err: any) {
      showToast(err?.message ?? "Failed to start two-factor setup.", "error");
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleConfirmEnableTwoFactor = async () => {
    if (!twoFactorOtp) {
      showToast("Enter the verification code to continue.", "error");
      return;
    }
    setTwoFactorLoading(true);
    try {
      await api.post("/settings/two-factor/confirm", { otp: twoFactorOtp });
      setTwoFactorAuth(true);
      setTwoFactorStep("idle");
      setTwoFactorOtp("");
      showToast("Two-factor authentication enabled.");
    } catch (err: any) {
      showToast(err?.message ?? "Invalid or expired code.", "error");
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleConfirmDisableTwoFactor = async () => {
    if (!twoFactorPassword) {
      showToast("Enter your password to disable two-factor authentication.", "error");
      return;
    }
    setTwoFactorLoading(true);
    try {
      await api.post("/settings/two-factor/disable", { password: twoFactorPassword });
      setTwoFactorAuth(false);
      setTwoFactorStep("idle");
      setTwoFactorPassword("");
      showToast("Two-factor authentication disabled.");
    } catch (err: any) {
      showToast(err?.message ?? "Failed to disable two-factor authentication.", "error");
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleToggleTwoFactor = () => {
    if (twoFactorStep !== "idle") {
      setTwoFactorStep("idle");
      setTwoFactorOtp("");
      setTwoFactorPassword("");
      return;
    }
    if (twoFactorAuth) {
      setTwoFactorStep("awaiting-password");
    } else {
      handleStartEnableTwoFactor();
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-xl px-5 py-3 text-sm font-medium shadow-lg transition-all ${
            toast.type === "success"
              ? "bg-[#2D6A4F] text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account preferences, security, and profile options</p>
      </div>

      {loadingSettings && (
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      )}

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
          {/* ---------------------------------------------------------------- */}
          {/* Appearance                                                        */}
          {/* ---------------------------------------------------------------- */}
          {activeSection === "appearance" && (
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
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
              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">Language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full max-w-xs rounded-xl border border-border bg-muted px-4 py-3 text-foreground text-sm"
                >
                  <option value="en">English</option>
                  <option value="fr">French</option>
                  <option value="rw">Kinyarwanda</option>
                </select>
              </div>
              <button
                onClick={handleSaveAppearance}
                disabled={savingAppearance}
                className="px-6 py-2 bg-[#2D6A4F] text-white rounded-xl hover:bg-[#1B4332] transition-colors text-sm font-medium disabled:opacity-60"
              >
                {savingAppearance ? "Saving…" : "Save Appearance"}
              </button>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Notifications                                                     */}
          {/* ---------------------------------------------------------------- */}
          {activeSection === "notifications" && (
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-card-foreground mb-1 flex items-center gap-2">
                  <Bell className="w-5 h-5 text-[#2D6A4F]" />
                  Notification Preferences
                </h2>
                <p className="text-sm text-muted-foreground">Customize how you receive updates and alerts.</p>
              </div>
              <div className="space-y-4">
                {[
                  { key: "emailNotifications", label: "Email Notifications", description: "Receive updates via email" },
                  { key: "smsNotifications", label: "SMS Notifications", description: "Receive updates via SMS" },
                  { key: "inAppNotifications", label: "In-App Notifications", description: "Receive updates inside the app" },
                ].map((option) => (
                  <div key={option.key} className="flex items-center justify-between p-4 bg-muted rounded-xl border border-border">
                    <div>
                      <p className="font-medium text-card-foreground">{option.label}</p>
                      <p className="text-sm text-muted-foreground">{option.description}</p>
                    </div>
                    <button
                      onClick={() => handleToggleNotification(option.key as keyof NotificationsData)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        notifications[option.key] ? "bg-[#2D6A4F]" : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          notifications[option.key] ? "translate-x-6" : "translate-x-1"
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
                    { label: "Loan Reminders", key: "loanDueReminders" },
                    { label: "Meeting Notifications", key: "activityReminders" },
                    { label: "Compliance Alerts", key: "complianceAlerts" },
                    { label: "Member Activity", key: "newMemberAlerts" },
                    { label: "Financial Updates", key: "monthlyReports" },
                    { label: "Login Notifications", key: "loginNotifications" },
                  ].map(({ label, key }) => (
                    <div key={label} className="flex items-center justify-between p-3 rounded-xl border border-gray-200">
                      <span className="text-sm text-gray-700">{label}</span>
                      <button
                        onClick={() => handleToggleNotification(key as keyof NotificationsData)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          notifications[key] ? "bg-[#2D6A4F]" : "bg-gray-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            notifications[key] ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={handleSaveNotifications}
                disabled={savingNotifications}
                className="px-6 py-2 bg-[#2D6A4F] text-white rounded-xl hover:bg-[#1B4332] transition-colors text-sm font-medium disabled:opacity-60"
              >
                {savingNotifications ? "Saving…" : "Save Notification Preferences"}
              </button>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Security                                                          */}
          {/* ---------------------------------------------------------------- */}
          {activeSection === "security" && (
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-6">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#2D6A4F]" />
                <h2 className="text-lg font-semibold text-card-foreground">Security Settings</h2>
              </div>
              <div className="p-4 rounded-xl border border-gray-200 bg-muted space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-card-foreground">Two-Factor Authentication</p>
                    <p className="text-sm text-muted-foreground">Add an extra security layer to your account.</p>
                  </div>
                  <button
                    onClick={handleToggleTwoFactor}
                    disabled={twoFactorLoading}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
                      twoFactorAuth ? "bg-[#2D6A4F]" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        twoFactorAuth ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {twoFactorStep === "awaiting-otp" && (
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-card-foreground mb-2">
                        Enter the verification code
                      </label>
                      <input
                        type="text"
                        value={twoFactorOtp}
                        onChange={(e) => setTwoFactorOtp(e.target.value)}
                        className="w-full px-4 py-3 bg-background border border-border rounded-xl text-foreground"
                        placeholder="6-digit code"
                      />
                    </div>
                    <button
                      onClick={handleConfirmEnableTwoFactor}
                      disabled={twoFactorLoading}
                      className="px-4 py-3 bg-[#2D6A4F] text-white rounded-xl hover:bg-[#1B4332] transition-colors text-sm font-medium disabled:opacity-60"
                    >
                      {twoFactorLoading ? "Confirming…" : "Confirm"}
                    </button>
                  </div>
                )}

                {twoFactorStep === "awaiting-password" && (
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-card-foreground mb-2">
                        Enter your password to disable 2FA
                      </label>
                      <input
                        type="password"
                        value={twoFactorPassword}
                        onChange={(e) => setTwoFactorPassword(e.target.value)}
                        className="w-full px-4 py-3 bg-background border border-border rounded-xl text-foreground"
                        placeholder="Current password"
                      />
                    </div>
                    <button
                      onClick={handleConfirmDisableTwoFactor}
                      disabled={twoFactorLoading}
                      className="px-4 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-60"
                    >
                      {twoFactorLoading ? "Disabling…" : "Disable"}
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold text-card-foreground flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#2D6A4F]" />
                  Change Password
                </h3>
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Current Password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground"
                    placeholder="Enter current password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground"
                    placeholder="Enter new password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground"
                    placeholder="Confirm new password"
                  />
                </div>
                <button
                  onClick={handleChangePassword}
                  disabled={savingPassword}
                  className="w-full px-4 py-2 bg-[#2D6A4F] text-white rounded-xl hover:bg-[#1B4332] transition-colors text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <Lock className="w-4 h-4" />
                  {savingPassword ? "Updating…" : "Update Password"}
                </button>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Profile                                                           */}
          {/* ---------------------------------------------------------------- */}
          {activeSection === "profile" && (
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-6">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-[#2D6A4F]" />
                <h2 className="text-lg font-semibold text-card-foreground">Profile Information</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Full Name</label>
                  <input
                    type="text"
                    value={profile.name ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground"
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Email</label>
                  <input
                    type="email"
                    value={profile.email ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground"
                    placeholder="Email address"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Phone</label>
                  <input
                    type="tel"
                    value={profile.phone ?? ""}
                    onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground"
                    placeholder="Phone number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Role</label>
                  <input
                    type="text"
                    value={profile.role ?? ""}
                    disabled
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground capitalize opacity-60"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="px-6 py-2 bg-[#2D6A4F] text-white rounded-xl hover:bg-[#1B4332] transition-colors text-sm font-medium disabled:opacity-60"
              >
                {savingProfile ? "Saving…" : "Save Profile"}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
