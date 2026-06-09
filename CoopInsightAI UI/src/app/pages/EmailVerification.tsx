import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { Mail, CheckCircle, XCircle, ArrowLeft } from "lucide-react";
import { Button } from "../components/Button";

export function EmailVerification() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { verifyEmail } = useAuth();
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<"pending" | "success" | "error">("pending");
  const [message, setMessage] = useState("");

  const email = searchParams.get("email");
  const token = searchParams.get("token");

  useEffect(() => {
    if (token && email) {
      handleVerification();
    }
  }, [token, email]);

  const handleVerification = async () => {
    if (!token || !email) return;

    setIsVerifying(true);
    const success = await verifyEmail(email, token);

    if (success) {
      setVerificationStatus("success");
      setMessage("Email verified successfully! You can now log in.");
      setTimeout(() => navigate("/login"), 3000);
    } else {
      setVerificationStatus("error");
      setMessage("Verification failed. The link may be expired or invalid.");
    }
    setIsVerifying(false);
  };

  const handleResendVerification = async () => {
    if (!email) return;

    setIsVerifying(true);
    // In a real app, this would call an API to resend verification email
    await new Promise(resolve => setTimeout(resolve, 1000));
    setMessage("Verification email sent! Please check your inbox.");
    setIsVerifying(false);
  };

  if (!email) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Invalid Link</h1>
          <p className="text-muted-foreground mb-6">The verification link is invalid or missing.</p>
          <Button onClick={() => navigate("/register")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Register
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4">
            <Mail className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">CoopInsightAI</h1>
          <p className="text-muted-foreground mt-2">Email Verification</p>
        </div>

        <div className="bg-card rounded-2xl shadow-sm p-8 border border-border text-center">
          {verificationStatus === "pending" && !token && (
            <>
              <Mail className="w-12 h-12 text-blue-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-card-foreground mb-4">
                Check your email
              </h2>
              <p className="text-muted-foreground mb-6">
                We've sent a verification link to <strong>{email}</strong>
              </p>
              <div className="space-y-4">
                <Button onClick={handleResendVerification} disabled={isVerifying} className="w-full">
                  {isVerifying ? "Sending..." : "Resend Verification Email"}
                </Button>
                <Button variant="outline" onClick={() => navigate("/register")} className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Register
                </Button>
              </div>
            </>
          )}

          {verificationStatus === "pending" && token && (
            <>
              <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold text-card-foreground mb-4">
                Verifying your email...
              </h2>
              <p className="text-muted-foreground">
                Please wait while we verify your email address.
              </p>
            </>
          )}

          {verificationStatus === "success" && (
            <>
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-card-foreground mb-4">
                Email Verified!
              </h2>
              <p className="text-muted-foreground mb-6">{message}</p>
              <Button onClick={() => navigate("/login")} className="w-full">
                Continue to Login
              </Button>
            </>
          )}

          {verificationStatus === "error" && (
            <>
              <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-card-foreground mb-4">
                Verification Failed
              </h2>
              <p className="text-muted-foreground mb-6">{message}</p>
              <div className="space-y-4">
                <Button onClick={handleResendVerification} disabled={isVerifying} className="w-full">
                  {isVerifying ? "Sending..." : "Resend Verification Email"}
                </Button>
                <Button variant="outline" onClick={() => navigate("/register")} className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Register
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}