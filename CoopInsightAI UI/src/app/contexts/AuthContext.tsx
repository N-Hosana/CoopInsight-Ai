import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

/**
 * Which tier of the sector → district → RCA chain an account decides at.
 *
 * `role` cannot answer this on its own: all three tiers carry the role
 * `government`, so a page that shows "RCA Officer" to a sector officer is
 * showing them somebody else's job. Every oversight-aware screen reads this.
 */
export type OversightLevel = "sector" | "district" | "rca";

interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "generalManager" | "member" | "government" | "cooperative";
  cooperativeId?: string;
  cooperativeName?: string;
  phone?: string;
  nationalId?: string;
  oversightLevel?: OversightLevel | null;
  sector?: string | null;
}

/** What each tier is called when it is shown to a person. */
export const OVERSIGHT_LABELS: Record<OversightLevel, string> = {
  sector: "Sector Cooperative Officer",
  district: "District Cooperative Officer",
  rca: "RCA Officer",
};

/**
 * The job title to print for an account, rather than the raw role. A sector
 * officer and the RCA both have role `government`; only one of them is the RCA.
 */
export function describeRole(user: {
  role: string;
  oversightLevel?: OversightLevel | null;
  sector?: string | null;
} | null): string {
  if (!user) return "";
  if (user.role === "government" && user.oversightLevel) {
    const label = OVERSIGHT_LABELS[user.oversightLevel];
    return user.oversightLevel === "sector" && user.sector ? `${label} — ${user.sector}` : label;
  }
  const labels: Record<string, string> = {
    admin: "System Administrator",
    manager: "Cooperative Manager",
    generalManager: "Gasabo General Manager",
    member: "Cooperative Member",
    government: "Oversight Officer",
    cooperative: "Cooperative Account",
  };
  return labels[user.role] ?? user.role;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string, role?: User["role"]) => Promise<boolean>;
  register: (data: RegisterData) => Promise<{ success: boolean; message: string }>;
  verifyEmail: (email: string, token: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  sendOTP: (email: string, password: string, role: User["role"]) => Promise<boolean>;
  verifyOTP: (email: string, otp: string) => Promise<boolean>;
  loginWithOTP: (email: string, role: User["role"]) => Promise<boolean>;
  loginAttempts: { [email: string]: number };
  lastLoginAttempt: { [email: string]: number };
  devOtp: string | null;
  /** Set when the failure was NOT bad credentials — server down, or locked. */
  loginError: string | null;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
  role: "admin" | "manager" | "generalManager" | "member" | "government" | "cooperative";
  cooperativeId?: string;
  phone?: string;
  nationalId?: string;
  cooperativeInfo?: Record<string, string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const authPost = async (endpoint: string, body: object): Promise<any> => {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // The backend is not answering — down, restarting, or the wrong URL. This
    // is NOT a credentials problem, and reporting it as one sends people off
    // retyping a password that was right all along.
    const err: any = new Error(
      "Could not reach the server. Check that the backend is running on " +
        `${API_URL.replace("/api", "")} and try again.`
    );
    err.status = 0;
    err.offline = true;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data.message || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
};

const mapApiUser = (apiUser: any): User => ({
  id: apiUser.id,
  name: apiUser.name,
  email: apiUser.email,
  role: apiUser.role,
  cooperativeId: apiUser.cooperativeId ?? apiUser.cooperative_id ?? undefined,
  cooperativeName: apiUser.cooperativeName ?? apiUser.cooperative_name ?? undefined,
  phone: apiUser.phone ?? undefined,
  oversightLevel: apiUser.oversightLevel ?? apiUser.oversight_level ?? null,
  sector: apiUser.sector ?? null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loginAttempts, setLoginAttempts] = useState<{ [email: string]: number }>({});
  const [lastLoginAttempt, setLastLoginAttempt] = useState<{ [email: string]: number }>({});

  // Transient state shared across the 3-step login flow
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  // The user resolved at password step, held until OTP verification commits it.
  // A ref rather than state: loginWithOTP has to read the latest value
  // synchronously within the same tick, which a state value cannot guarantee.
  const pendingUserRef = useRef<User | null>(null);
  // Dev-mode OTP hint (backend returns this when NODE_ENV !== production)
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * REVALIDATE THE STORED SESSION ON LOAD
   * ───────────────────────────────────────────────────────────────────────────
   *
   * The stored user was read straight out of localStorage and trusted, which
   * meant the header could say one thing while the page said another. That is
   * exactly what happens when an account's cooperative changes underneath a
   * live session: the header kept rendering the cooperative name cached at
   * login, while every request carried a JWT whose `cooperativeId` claim was
   * already stale — so the page correctly reported "not linked to a
   * cooperative" and the header contradicted it.
   *
   * `/auth/me` reads the row rather than the token, so it is the truth. The
   * cached copy is shown immediately (so the app does not flash empty) and then
   * corrected. A 401 means the session is genuinely finished, and we clear it
   * rather than leaving someone on a page whose every request will fail.
   */
  useEffect(() => {
    const stored = localStorage.getItem("coopinsight_user");
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { /* ignore */ }
    }

    const token = localStorage.getItem("coopinsight_access_token");
    if (!token) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 401) {
          // The refresh path in services/api.ts handles expiry for ordinary
          // requests; reaching here means the session cannot be recovered.
          localStorage.removeItem("coopinsight_user");
          localStorage.removeItem("coopinsight_access_token");
          localStorage.removeItem("coopinsight_refresh_token");
          if (!cancelled) setUser(null);
          return;
        }
        if (!res.ok) return;

        const fresh = mapApiUser(await res.json());
        if (cancelled) return;
        setUser(fresh);
        localStorage.setItem("coopinsight_user", JSON.stringify(fresh));
      } catch {
        // Offline or the backend is restarting. Keep the cached user rather
        // than signing someone out because their laptop lost wifi.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Step 1: validate credentials, dispatch OTP ───────────────────────────
  const sendOTP = async (email: string, password: string, _role: User["role"]): Promise<boolean> => {
    setLoginError(null);
    try {
      const data = await authPost("/auth/login", { email, password });
      setPendingUserId(data.userId);
      if (data.devOtp) setDevOtp(data.devOtp);
      setLoginAttempts(prev => ({ ...prev, [email]: 0 }));
      return true;
    } catch (err: any) {
      // A server that cannot be reached is not a failed login attempt. Counting
      // it as one would eventually lock a valid account out of a backend that
      // was simply restarting.
      if (err.offline) {
        setLoginError(err.message);
        return false;
      }

      setLastLoginAttempt(prev => ({ ...prev, [email]: Date.now() }));
      if (err.status === 423) {
        // Account locked — max out the counter so Login.tsx shows lockout UI
        setLoginAttempts(prev => ({ ...prev, [email]: 5 }));
        setLoginError(err.message);
      } else {
        setLoginAttempts(prev => ({ ...prev, [email]: (prev[email] || 0) + 1 }));
        setLoginError(null);
      }
      return false;
    }
  };

  // ─── Step 2: verify OTP, receive tokens ───────────────────────────────────
  const verifyOTP = async (_email: string, otp: string): Promise<boolean> => {
    if (!pendingUserId) return false;
    try {
      const data = await authPost("/auth/verify-otp", { userId: pendingUserId, otp });
      localStorage.setItem("coopinsight_access_token", data.accessToken);
      localStorage.setItem("coopinsight_refresh_token", data.refreshToken);
      const mapped = mapApiUser(data.user);
      pendingUserRef.current = mapped;
      return true;
    } catch {
      return false;
    }
  };

  // ─── Step 3: commit the verified user to state ───────────────────────────
  const loginWithOTP = async (_email: string, _role: User["role"]): Promise<boolean> => {
    const userToCommit = pendingUserRef.current;
    if (!userToCommit) return false;
    setUser(userToCommit);
    localStorage.setItem("coopinsight_user", JSON.stringify(userToCommit));
    pendingUserRef.current = null;
    setPendingUserId(null);
    setDevOtp(null);
    return true;
  };

  // ─── Single-step login (not used by Login.tsx but kept for completeness) ──
  const login = async (email: string, password: string, _role?: User["role"]): Promise<boolean> => {
    const ok = await sendOTP(email, password, "member");
    return ok;
  };

  // ─── Register ─────────────────────────────────────────────────────────────
  const register = async (data: RegisterData): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await authPost("/auth/register", {
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
        cooperativeId: data.cooperativeId,
        phone: data.phone,
        nationalId: data.nationalId,
      });
      return { success: true, message: res.message || "Verification email sent. Please check your inbox." };
    } catch (err: any) {
      if (err.status === 409) return { success: false, message: "Email already registered." };
      return { success: false, message: err.message || "Registration failed. Please try again." };
    }
  };

  // ─── Verify email ─────────────────────────────────────────────────────────
  const verifyEmail = async (email: string, token: string): Promise<boolean> => {
    try {
      await authPost("/auth/verify-email", { email, token });
      return true;
    } catch {
      return false;
    }
  };

  // ─── Logout ───────────────────────────────────────────────────────────────
  const logout = async () => {
    const token = localStorage.getItem("coopinsight_access_token");
    if (token) {
      try {
        await fetch(`${API_URL}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        });
      } catch { /* fire-and-forget */ }
    }
    setUser(null);
    localStorage.removeItem("coopinsight_user");
    localStorage.removeItem("coopinsight_access_token");
    localStorage.removeItem("coopinsight_refresh_token");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        register,
        verifyEmail,
        logout,
        isAuthenticated: !!user,
        sendOTP,
        verifyOTP,
        loginWithOTP,
        loginAttempts,
        lastLoginAttempt,
        devOtp,
        loginError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
