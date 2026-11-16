import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Mail, ArrowLeft, Check, Lock, AlertCircle, KeyRound } from "lucide-react";
import { AuthBackground } from "../components/AuthBackground";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

/**
 * Forgot password, in the order the backend checks it:
 *
 *   1. EMAIL     POST /auth/forgot-password       → a 6-digit code is emailed
 *   2. CODE      POST /auth/verify-reset-otp      → returns a one-time resetToken
 *   3. PASSWORD  POST /auth/reset-password        → { resetToken, newPassword, confirmPassword }
 *   4. DONE
 *
 * The page used to stop after step 1 with "follow the link" — but the email
 * carries a code, not a link — and its last step posted fields the backend
 * does not read, so no reset could succeed from it.
 *
 * Outside production the backend also returns the code (`devOtp`), shown in
 * the amber box with Auto-fill exactly as on the sign-in page, so a seeded
 * account whose address is not a real mailbox can still be reset.
 */

type Step = "email" | "code" | "password" | "done";

async function post(path: string, body: object) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? "Something went wrong. Please try again.");
  return data;
}

const inputClass =
  "w-full pl-10 pr-4 py-3 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground";
const buttonClass =
  "w-full bg-primary text-primary-foreground py-3 rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed";

export function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  const run = async (fn: () => Promise<void>) => {
    setError("");
    setIsLoading(true);
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message ?? "Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── 1. Ask for a code ─────────────────────────────────────────────────────
  const sendCode = (e?: React.FormEvent) => {
    e?.preventDefault();
    run(async () => {
      const data = await post("/auth/forgot-password", { email: email.trim() });
      setDevOtp(data.devOtp ?? null);
      setOtp(["", "", "", "", "", ""]);
      setNotice(`If ${email.trim()} has an account, a 6-digit code is on its way. It expires in 5 minutes.`);
      setStep("code");
      setTimeout(() => boxes.current[0]?.focus(), 50);
    });
  };

  // ── 2. Check the code ─────────────────────────────────────────────────────
  const setDigit = (index: number, value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length > 1) {
      // Pasted the whole code into one box.
      const next = [...otp];
      digits.slice(0, 6 - index).split("").forEach((d, i) => (next[index + i] = d));
      setOtp(next);
      boxes.current[Math.min(index + digits.length, 5)]?.focus();
      return;
    }
    const next = [...otp];
    next[index] = digits;
    setOtp(next);
    if (digits && index < 5) boxes.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) boxes.current[index - 1]?.focus();
  };

  const verifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const data = await post("/auth/verify-reset-otp", { email: email.trim(), otp: otp.join("") });
      setResetToken(data.resetToken);
      setNotice("");
      setStep("password");
    });
  };

  // ── 3. Choose the new password ────────────────────────────────────────────
  const resetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return setError("The two passwords do not match.");
    if (newPassword.length < 8) return setError("The password must be at least 8 characters.");
    run(async () => {
      await post("/auth/reset-password", { resetToken, newPassword, confirmPassword });
      setStep("done");
    });
  };

  const titles: Record<Step, [string, string]> = {
    email: ["Forgot your password?", "Enter your email and we'll send you a 6-digit code."],
    code: ["Enter the code", `Sent to ${email.trim()}`],
    password: ["Choose a new password", "At least 8 characters."],
    done: ["Password changed", "You can now sign in with your new password."],
  };

  return (
    <AuthBackground
      tagline="Back into your account"
      subtext="Reset your password with a one-time code sent to your email."
    >
      <div className="w-full max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-3">
            {step === "done" ? <Check className="w-6 h-6 text-primary" /> : step === "code" ? <KeyRound className="w-6 h-6 text-primary" /> : <Lock className="w-6 h-6 text-primary" />}
          </div>
          <h2 className="text-3xl font-bold text-card-foreground">{titles[step][0]}</h2>
          <p className="text-muted-foreground mt-2">{titles[step][1]}</p>
        </div>

        {error && (
          <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {notice && step === "code" && (
          <div className="mb-5 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">{notice}</p>
          </div>
        )}

        {/* 1. Email */}
        {step === "email" && (
          <form onSubmit={sendCode} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-card-foreground mb-2">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className={inputClass} placeholder="you@example.com" autoComplete="email" required autoFocus />
              </div>
            </div>
            <button type="submit" disabled={isLoading} className={buttonClass}>
              {isLoading ? "Sending code..." : "Send Reset Code"}
            </button>
          </form>
        )}

        {/* 2. Code */}
        {step === "code" && (
          <form onSubmit={verifyCode} className="space-y-5">
            {devOtp && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg">
                <p className="text-xs font-semibold text-amber-800 mb-1">Dev mode — reset code:</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xl font-mono font-bold tracking-widest text-amber-900">{devOtp}</span>
                  <button type="button" onClick={() => setOtp(devOtp.split(""))}
                    className="text-xs px-2 py-1 bg-amber-200 text-amber-900 rounded hover:bg-amber-300 transition-colors">
                    Auto-fill
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-center">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => { boxes.current[index] = el; }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  maxLength={6}
                  value={digit}
                  onChange={(e) => setDigit(index, e.target.value)}
                  onKeyDown={(e) => onKeyDown(index, e)}
                  aria-label={`Digit ${index + 1}`}
                  className="w-12 h-14 text-center text-xl font-semibold bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                />
              ))}
            </div>

            <button type="submit" disabled={isLoading || otp.some((d) => !d)} className={buttonClass}>
              {isLoading ? "Checking..." : "Verify Code"}
            </button>

            <p className="text-center text-sm text-muted-foreground">
              Didn't get it?{" "}
              <button type="button" onClick={() => sendCode()} disabled={isLoading} className="text-primary font-medium hover:underline disabled:opacity-50">
                Send a new code
              </button>
              {" · "}
              <button type="button" onClick={() => { setStep("email"); setError(""); }} className="text-primary font-medium hover:underline">
                Use another email
              </button>
            </p>
          </form>
        )}

        {/* 3. New password */}
        {step === "password" && (
          <form onSubmit={resetPassword} className="space-y-5">
            {[
              ["New Password", newPassword, setNewPassword],
              ["Confirm Password", confirmPassword, setConfirmPassword],
            ].map(([label, value, set]) => (
              <div key={label as string}>
                <label className="block text-sm font-medium text-card-foreground mb-2">{label as string}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input type="password" value={value as string}
                    onChange={(e) => (set as (v: string) => void)(e.target.value)}
                    className={inputClass} placeholder="••••••••" autoComplete="new-password" required minLength={8} />
                </div>
              </div>
            ))}
            <button type="submit" disabled={isLoading} className={buttonClass}>
              {isLoading ? "Saving..." : "Reset Password"}
            </button>
          </form>
        )}

        {/* 4. Done */}
        {step === "done" && (
          <button onClick={() => navigate("/login")} className={buttonClass}>Back to Sign In</button>
        )}

        {step !== "done" && (
          <div className="mt-6 text-center">
            <Link to="/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
              Back to Sign In
            </Link>
          </div>
        )}
      </div>
    </AuthBackground>
  );
}
