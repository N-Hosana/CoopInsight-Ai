import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "generalManager" | "member" | "government" | "cooperative";
  cooperativeId?: string; // For members, managers, and cooperative accounts
  cooperativeName?: string;
  phone?: string;
  nationalId?: string;
}

interface CooperativeRegistrationInfo {
  registrationNumber?: string;
  district?: string;
  sector?: string;
  cooperativeType?: string;
  chairperson?: string;
  treasurer?: string;
  secretary?: string;
  registrationDate?: string;
  status?: string;
  bylawsFileName?: string;
  licenseFileName?: string;
  permitsFileName?: string;
  operatingArea?: string;
  membershipSize?: string;
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
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
  role: "admin" | "manager" | "generalManager" | "member" | "government" | "cooperative";
  cooperativeId?: string;
  phone?: string;
  nationalId?: string;
  cooperativeInfo?: CooperativeRegistrationInfo;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface CooperativeProfileData {
  id: string;
  name: string;
  registrationNumber: string;
  district: string;
  sector: string;
  type: string;
  chairperson: string;
  treasurer: string;
  secretary: string;
  registrationDate: string;
  status: string;
  bylawsFileName: string;
  licenseFileName: string;
  permitsFileName: string;
  operatingArea: string;
  membershipSize: string;
  description: string;
  documents: { id: string; name: string; type: string; uploadedAt: string }[];
}

function getStoredCooperatives(): CooperativeProfileData[] {
  try {
    const stored = localStorage.getItem("coopinsight_cooperatives");
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return [];
}

function saveStoredCooperatives(cooperatives: CooperativeProfileData[]) {
  localStorage.setItem("coopinsight_cooperatives", JSON.stringify(cooperatives));
}

// Mock users database (in real app, this would be in backend)
const MOCK_USERS: User[] = [
  {
    id: "admin-1",
    name: "John Anderson",
    email: "admin@coopinsight.ai",
    role: "admin",
    phone: "+250788123456",
    nationalId: "1198712345678901",
  },
  {
    id: "manager-1",
    name: "David Mugisha",
    email: "manager@greenvalley.coop",
    role: "manager",
    cooperativeId: "coop-1",
    cooperativeName: "Green Valley Farmers",
    phone: "+250788234567",
    nationalId: "1199012345678902",
  },
  {
    id: "gm-1",
    name: "Gasabo General Manager",
    email: "gm@gasabo.coop",
    role: "generalManager",
    phone: "+250788765432",
    nationalId: "1999912345678907",
  },
  {
    id: "government-1",
    name: "Dr. Alice Uwase",
    email: "gov@rca.gov.rw",
    role: "government",
    phone: "+250788345678",
    nationalId: "1198512345678903",
  },
  {
    id: "member-1",
    name: "Sarah Johnson",
    email: "sarah@greenvalley.coop",
    role: "member",
    cooperativeId: "coop-1",
    cooperativeName: "Green Valley Farmers",
    phone: "+250788456789",
    nationalId: "1199212345678904",
  },
  {
    id: "member-2",
    name: "Michael Chen",
    email: "michael@sunrise.coop",
    role: "member",
    cooperativeId: "coop-2",
    cooperativeName: "Sunrise Dairy Cooperative",
    phone: "+250788567890",
    nationalId: "1199312345678905",
  },
  {
    id: "member-3",
    name: "Emily Rodriguez",
    email: "emily@oceanview.coop",
    role: "member",
    cooperativeId: "coop-3",
    cooperativeName: "Ocean View Fisheries",
    phone: "+250788678901",
    nationalId: "1199412345678906",
  },
  {
    id: "cooperative-1",
    name: "Green Valley Farmers",
    email: "cooperative@greenvalley.coop",
    role: "cooperative",
    cooperativeId: "coop-1",
    cooperativeName: "Green Valley Farmers",
    phone: "+250788000111",
    nationalId: "0000000000000000",
  },
];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loginAttempts, setLoginAttempts] = useState<{ [email: string]: number }>({});
  const [lastLoginAttempt, setLastLoginAttempt] = useState<{ [email: string]: number }>({});
  const [pendingVerifications, setPendingVerifications] = useState<{ [email: string]: { token: string; data: RegisterData; expires: number } }>({});
  const [activeOTPs, setActiveOTPs] = useState<{ [email: string]: { otp: string; expires: number } }>({});
  const [sessionTimeout, setSessionTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Check if user is already logged in (from localStorage)
    const storedUser = localStorage.getItem("coopinsight_user");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const login = async (email: string, _password: string, role?: User["role"]): Promise<boolean> => {
    // Check login attempts
    const now = Date.now();
    const attempts = loginAttempts[email] || 0;
    const lastAttempt = lastLoginAttempt[email] || 0;

    // Lockout for 15 minutes after 5 failed attempts
    if (attempts >= 5 && now - lastAttempt < 15 * 60 * 1000) {
      return false;
    }

    // Reset attempts if more than 15 minutes have passed
    if (now - lastAttempt > 15 * 60 * 1000) {
      setLoginAttempts(prev => ({ ...prev, [email]: 0 }));
    }

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500));

    // For demo purposes, any password works
    const foundUser = MOCK_USERS.find((u) => u.email === email);

    if (foundUser && (!role || foundUser.role === role)) {
      setUser(foundUser);
      localStorage.setItem("coopinsight_user", JSON.stringify(foundUser));
      // Reset login attempts on success
      setLoginAttempts(prev => ({ ...prev, [email]: 0 }));
      // Set session timeout (30 minutes)
      if (sessionTimeout) clearTimeout(sessionTimeout);
      const timeout = setTimeout(() => {
        logout();
      }, 30 * 60 * 1000);
      setSessionTimeout(timeout);
      return true;
    }

    // Increment failed attempts
    setLoginAttempts(prev => ({ ...prev, [email]: attempts + 1 }));
    setLastLoginAttempt(prev => ({ ...prev, [email]: now }));

    return false;
  };

  const register = async (data: RegisterData): Promise<{ success: boolean; message: string }> => {
    // Check if email already exists
    const existingUser = MOCK_USERS.find(u => u.email === data.email);
    if (existingUser) {
      return { success: false, message: "Email already registered" };
    }

    // Generate verification token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const expires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    // Store pending verification
    setPendingVerifications(prev => ({
      ...prev,
      [data.email]: { token, data, expires }
    }));

    // Simulate sending email
    await new Promise((resolve) => setTimeout(resolve, 500));

    // In a real app, send email with verification link
    console.log(`Verification link: /email-verification?email=${encodeURIComponent(data.email)}&token=${token}`);

    return { success: true, message: "Verification email sent. Please check your inbox." };
  };

  const verifyEmail = async (email: string, token: string): Promise<boolean> => {
    const pending = pendingVerifications[email];
    if (!pending || pending.token !== token || Date.now() > pending.expires) {
      return false;
    }

    // Create the user
    const newUser: User = {
      id: `user-${Date.now()}`,
      name: pending.data.name,
      email: pending.data.email,
      role: pending.data.role,
      cooperativeId: pending.data.cooperativeId,
      cooperativeName: pending.data.role === "cooperative" ? pending.data.name : undefined,
      phone: pending.data.phone,
      nationalId: pending.data.nationalId,
    };

    MOCK_USERS.push(newUser);

    if (pending.data.role === "cooperative" && pending.data.cooperativeInfo) {
      const existing = getStoredCooperatives();
      const cooperativeProfile: CooperativeProfileData = {
        id: pending.data.cooperativeId || `coop-${Date.now()}`,
        name: pending.data.name,
        registrationNumber: pending.data.cooperativeInfo.registrationNumber || "",
        district: pending.data.cooperativeInfo.district || "",
        sector: pending.data.cooperativeInfo.sector || "",
        type: pending.data.cooperativeInfo.cooperativeType || "",
        chairperson: pending.data.cooperativeInfo.chairperson || "",
        treasurer: pending.data.cooperativeInfo.treasurer || "",
        secretary: pending.data.cooperativeInfo.secretary || "",
        registrationDate: pending.data.cooperativeInfo.registrationDate || "",
        status: pending.data.cooperativeInfo.status || "Pending",
        bylawsFileName: pending.data.cooperativeInfo.bylawsFileName || "Not uploaded",
        licenseFileName: pending.data.cooperativeInfo.licenseFileName || "Not uploaded",
        permitsFileName: pending.data.cooperativeInfo.permitsFileName || "Not uploaded",
        operatingArea: pending.data.cooperativeInfo.operatingArea || "",
        membershipSize: pending.data.cooperativeInfo.membershipSize || "",
        description: `Profile generated for ${pending.data.name}.`, 
        documents: [
          {
            id: `doc-${Date.now()}-bylaws`,
            name: pending.data.cooperativeInfo.bylawsFileName || "Cooperative Bylaws",
            type: "Bylaws",
            uploadedAt: new Date().toLocaleDateString(),
          },
          {
            id: `doc-${Date.now()}-license`,
            name: pending.data.cooperativeInfo.licenseFileName || "Business License",
            type: "License",
            uploadedAt: new Date().toLocaleDateString(),
          },
          {
            id: `doc-${Date.now()}-permit`,
            name: pending.data.cooperativeInfo.permitsFileName || "Operating Permit",
            type: "Permit",
            uploadedAt: new Date().toLocaleDateString(),
          },
        ],
      };
      saveStoredCooperatives([...existing, cooperativeProfile]);
    }

    setPendingVerifications(prev => {
      const updated = { ...prev };
      delete updated[email];
      return updated;
    });

    return true;
  };

  const sendOTP = async (email: string, _password: string, role: User["role"]): Promise<boolean> => {
    // First validate credentials
    const foundUser = MOCK_USERS.find((u) => u.email === email);

    if (!foundUser || foundUser.role !== role) {
      return false; // Invalid credentials
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

    setActiveOTPs(prev => ({
      ...prev,
      [email]: { otp, expires }
    }));

    // Simulate sending OTP
    await new Promise((resolve) => setTimeout(resolve, 500));

    // In a real app, send SMS/email with OTP
    console.log(`OTP for ${email}: ${otp}`);

    return true;
  };

  const verifyOTP = async (email: string, otp: string): Promise<boolean> => {
    const activeOTP = activeOTPs[email];
    if (!activeOTP || activeOTP.otp !== otp || Date.now() > activeOTP.expires) {
      return false;
    }

    setActiveOTPs(prev => {
      const updated = { ...prev };
      delete updated[email];
      return updated;
    });

    return true;
  };

  const loginWithOTP = async (email: string, role: User["role"]): Promise<boolean> => {
    const foundUser = MOCK_USERS.find((u) => u.email === email && u.role === role);

    if (foundUser) {
      setUser(foundUser);
      localStorage.setItem("coopinsight_user", JSON.stringify(foundUser));
      setLoginAttempts(prev => ({ ...prev, [email]: 0 }));
      if (sessionTimeout) clearTimeout(sessionTimeout);
      const timeout = setTimeout(() => {
        logout();
      }, 30 * 60 * 1000);
      setSessionTimeout(timeout);
      return true;
    }

    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("coopinsight_user");
    if (sessionTimeout) {
      clearTimeout(sessionTimeout);
      setSessionTimeout(null);
    }
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
