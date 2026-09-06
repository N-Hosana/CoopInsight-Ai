import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { AuthBackground } from "../components/AuthBackground";
import { LogIn, Mail, Lock, AlertCircle, ArrowLeft } from "lucide-react";

export function Login() {
  const navigate = useNavigate();
  const { sendOTP, verifyOTP, loginWithOTP, loginAttempts, lastLoginAttempt, devOtp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "manager" | "generalManager" | "member" | "government">("member");
  const [showOTP, setShowOTP] = useState(false);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Check for account lockout
    const now = Date.now();
    const attempts = loginAttempts[email] || 0;
    const lastAttempt = lastLoginAttempt[email] || 0;

    if (attempts >= 5 && now - lastAttempt < 15 * 60 * 1000) {
      const remainingTime = Math.ceil((15 * 60 * 1000 - (now - lastAttempt)) / 60000);
      setError(`Account locked due to too many failed attempts. Try again in ${remainingTime} minutes.`);
      return;
    }

    setIsLoading(true);

    // Send OTP for all users (now validates credentials)
    const otpSent = await sendOTP(email, password, role);
    if (otpSent) {
      setShowOTP(true);
    } else {
      setError("Invalid email, password, or role. Please check your credentials.");
    }

    setIsLoading(false);
  };

  const handleOTPChange = (index: number, value: string) => {
    if (value.length > 1) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const otpCode = otp.join("");
    const isValidOTP = await verifyOTP(email, otpCode);

    if (isValidOTP) {
      const success = await loginWithOTP(email, role);
      if (success) {
        navigate("/");
      } else {
        setError("Login failed. Please try again.");
      }
    } else {
      setError("Invalid verification code. Please try again.");
    }

    setIsLoading(false);
  };

  const handleBackToLogin = () => {
    setShowOTP(false);
    setOtp(["", "", "", "", "", ""]);
    setEmail("");
    setPassword("");
    setRole("member");
    setError("");
    setIsLoading(false);
  };

  return (
    <div className="h-screen bg-background flex">
      <AuthBackground
        tagline="Empowering Rwanda's Cooperatives"
        subtext="Real-time insights, transparent governance, and AI-driven decisions for cooperatives across Gasabo District."
      />
      <div className="flex-1 h-screen flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4">
            <LogIn className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">CoopInsightAI</h1>
          <p className="text-muted-foreground mt-2">Gasabo District Platform</p>
        </div>

        {/* Login Card */}
        <div className="bg-card rounded-2xl shadow-sm p-8 border border-border">
          <h2 className="text-2xl font-semibold text-card-foreground mb-6">
            {showOTP ? "Enter Verification Code" : "Sign in to your account"}
          </h2>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {!showOTP ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">I am a</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                  className="w-full px-4 py-3 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                >
                  <option value="member">Cooperative Member</option>
                  <option value="manager">Cooperative Manager</option>
                  <option value="generalManager">Gasabo General Manager</option>
                  <option value="government">RCA Officer</option>
                  <option value="admin">System Administrator</option>
                  {/* cooperative account removed */}
                </select>
              </div>
            <div>
              <label className="block text-sm font-medium text-card-foreground mb-2">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-card-foreground">Password</label>
                <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Sending code..." : "Send Verification Code"}
            </button>
          </form>
          ) : (
            <form onSubmit={handleOTPSubmit} className="space-y-5">
              <div className="text-center mb-4">
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code sent to your device
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Code sent to: {email}
                </p>
              </div>

              {devOtp && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg">
                  <p className="text-xs font-semibold text-amber-800 mb-1">Dev mode — OTP code:</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xl font-mono font-bold tracking-widest text-amber-900">{devOtp}</span>
                    <button
                      type="button"
                      onClick={() => setOtp(devOtp.split(""))}
                      className="text-xs px-2 py-1 bg-amber-200 text-amber-900 rounded hover:bg-amber-300 transition-colors"
                    >
                      Auto-fill
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-center">
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    id={`otp-${index}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOTPChange(index, e.target.value)}
                    className="w-12 h-14 text-center text-xl font-semibold bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                    required
                  />
                ))}
              </div>
              <button
                type="submit"
                disabled={isLoading || otp.some((d) => !d)}
                className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Verifying..." : "Verify & Sign In"}
              </button>
              <button
                type="button"
                onClick={handleBackToLogin}
                className="w-full text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to login
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link to="/register" className="text-primary font-medium hover:underline">
                Register here
              </Link>
            </p>
          </div>

          {/* Seeded Credentials */}
          <div className="mt-8 p-4 bg-muted rounded-lg border border-border">
            <p className="text-xs font-semibold text-card-foreground mb-3">Test Accounts (seeded):</p>
            <div className="text-xs text-muted-foreground space-y-1.5 font-mono">
              <div className="grid grid-cols-[80px_1fr_1fr] gap-x-2">
                <span className="text-[10px] font-sans font-semibold text-muted-foreground uppercase tracking-wide">Role</span>
                <span className="text-[10px] font-sans font-semibold text-muted-foreground uppercase tracking-wide">Email</span>
                <span className="text-[10px] font-sans font-semibold text-muted-foreground uppercase tracking-wide">Password</span>
              </div>
              <div className="grid grid-cols-[80px_1fr_1fr] gap-x-2 text-card-foreground">
                <span>Admin</span>
                <span>admin@coopinsight.rw</span>
                <span>Admin@1234</span>
              </div>
              <div className="grid grid-cols-[80px_1fr_1fr] gap-x-2 text-card-foreground">
                <span>Manager</span>
                <span>manager@coopinsight.rw</span>
                <span>Manager@1234</span>
              </div>
              <div className="grid grid-cols-[80px_1fr_1fr] gap-x-2 text-card-foreground">
                <span>Member</span>
                <span>member@coopinsight.rw</span>
                <span>Member@1234</span>
              </div>
              <div className="grid grid-cols-[80px_1fr_1fr] gap-x-2 text-card-foreground">
                <span>RCA</span>
                <span>gov@coopinsight.rw</span>
                <span>Gov@1234!</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
