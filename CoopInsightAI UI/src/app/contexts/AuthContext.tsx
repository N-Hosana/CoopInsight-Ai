import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "generalManager" | "member" | "government" | "cooperative";
  cooperativeId?: string;
  cooperativeName?: string;
  phone?: string;
  nationalId?: string;
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
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
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

  useEffect(() => {
    const stored = localStorage.getItem("coopinsight_user");
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { /* ignore */ }
    }
  }, []);

  // ─── Step 1: validate credentials, dispatch OTP ───────────────────────────
  const sendOTP = async (email: string, password: string, _role: User["role"]): Promise<boolean> => {
    try {
      const data = await authPost("/auth/login", { email, password });
      setPendingUserId(data.userId);
      if (data.devOtp) setDevOtp(data.devOtp);
      setLoginAttempts(prev => ({ ...prev, [email]: 0 }));
      return true;
    } catch (err: any) {
      setLastLoginAttempt(prev => ({ ...prev, [email]: Date.now() }));
      if (err.status === 423) {
        // Account locked — max out the counter so Login.tsx shows lockout UI
        setLoginAttempts(prev => ({ ...prev, [email]: 5 }));
      } else {
        setLoginAttempts(prev => ({ ...prev, [email]: (prev[email] || 0) + 1 }));
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
