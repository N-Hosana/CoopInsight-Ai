import { useState, useMemo } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { GASABO_SECTORS } from "../data/gasaboData";
import { UserPlus, Mail, Lock, User, Building2, Phone, CreditCard, Check, X, MapPin } from "lucide-react";

export function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    nationalId: "",
    password: "",
    confirmPassword: "",
    role: "member" as "admin" | "manager" | "member" | "government" | "generalManager",
    cooperativeId: "",
    sector: "",
    registrationNumber: "",
    cooperativeType: "",
    district: "",
    chairperson: "",
    treasurer: "",
    secretary: "",
    registrationDate: "",
    status: "Active",
    operatingArea: "",
    membershipSize: "",
    bylawsFileName: "",
    licenseFileName: "",
    permitsFileName: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const cooperatives = [
    { id: "coop-1", name: "Terimbere Kacyiru Coffee Cooperative", sector: "kacyiru" },
    { id: "coop-2", name: "Abakundakawa Remera", sector: "remera" },
    { id: "coop-3", name: "Imbuto Kimironko Dairy", sector: "kimironko" },
    { id: "coop-4", name: "Dukore Gisozi Handicrafts", sector: "gisozi" },
    { id: "coop-5", name: "Twisungane Kinyinya Agriculture", sector: "kinyinya" },
    { id: "coop-6", name: "Amizero Jabana Poultry", sector: "jabana" },
  ];

  const passwordStrength = useMemo(() => {
    const password = formData.password;
    if (!password) return { score: 0, label: "", color: "" };

    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;

    if (score <= 2) return { score, label: "Weak", color: "bg-red-500" };
    if (score <= 3) return { score, label: "Fair", color: "bg-yellow-500" };
    if (score <= 4) return { score, label: "Good", color: "bg-blue-500" };
    return { score, label: "Strong", color: "bg-green-500" };
  }, [formData.password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if ((formData.role === "member" || formData.role === "manager") && !formData.cooperativeId) {
      setError("Please select a cooperative");
      return;
    }

    setIsLoading(true);

    const cooperativeId = formData.cooperativeId || undefined;

    const result = await register({
      name: formData.name,
      email: formData.email,
      password: formData.password,
      role: formData.role,
      phone: formData.phone,
      nationalId: formData.nationalId,
      cooperativeId,
    });

    if (result.success) {
      navigate(`/email-verification?email=${encodeURIComponent(formData.email)}`);
    } else {
      setError(result.message);
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4">
            <UserPlus className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">CoopInsightAI</h1>
          <p className="text-muted-foreground mt-2">Create your account - Gasabo District</p>
        </div>

        <div className="bg-card rounded-2xl shadow-sm p-8 border border-border">
          <h2 className="text-2xl font-semibold text-card-foreground mb-6">Register</h2>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                    placeholder="Jean Uwimana"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2563EB] focus:border-transparent outline-none"
                    placeholder="+250788123456"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">National ID</label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={formData.nationalId}
                    onChange={(e) => setFormData({ ...formData, nationalId: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2563EB] focus:border-transparent outline-none"
                    placeholder="1198712345678901"
                    required
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account Type</label>
              <select
                value={formData.role}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    role: e.target.value as "admin" | "manager" | "member" | "government" | "generalManager",
                  })
                }
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2563EB] focus:border-transparent outline-none"
              >
                <option value="member">Cooperative Member</option>
                <option value="manager">Cooperative Manager</option>
                <option value="generalManager">Gasabo General Manager</option>
                <option value="government">Government Official</option>
                <option value="admin">System Administrator</option>
                {/* cooperative account removed */}
              </select>
            </div>

            {(formData.role === "member" || formData.role === "manager") && (
              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">Sector (Gasabo District)</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <select
                    value={formData.sector}
                    onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                    required
                  >
                    <option value="">Select your sector...</option>
                    {GASABO_SECTORS.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {(formData.role === "member" || formData.role === "manager") && (
              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">Select Your Cooperative</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <select
                    value={formData.cooperativeId}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        cooperativeId: e.target.value,
                      })
                    }
                    className="w-full pl-10 pr-4 py-3 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                    required
                  >
                    <option value="">Choose a cooperative...</option>
                    {cooperatives
                      .filter((coop) => !formData.sector || coop.sector === formData.sector)
                      .map((coop) => (
                        <option key={coop.id} value={coop.id}>
                          {coop.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2563EB] focus:border-transparent outline-none"
                  placeholder="••••••••"
                  required
                />
              </div>
              {formData.password && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-600">Password strength:</span>
                    <span className={`text-xs font-medium ${passwordStrength.label === "Weak" ? "text-red-600" : passwordStrength.label === "Fair" ? "text-yellow-600" : passwordStrength.label === "Good" ? "text-blue-600" : "text-green-600"}`}>
                      {passwordStrength.label}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${passwordStrength.color}`}
                      style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                    ></div>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      {formData.password.length >= 8 ? (
                        <Check className="w-3 h-3 text-green-600" />
                      ) : (
                        <X className="w-3 h-3 text-gray-400" />
                      )}
                      <span className={formData.password.length >= 8 ? "text-green-600" : "text-gray-500"}>
                        At least 8 characters
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {/[a-z]/.test(formData.password) && /[A-Z]/.test(formData.password) ? (
                        <Check className="w-3 h-3 text-green-600" />
                      ) : (
                        <X className="w-3 h-3 text-gray-400" />
                      )}
                      <span
                        className={
                          /[a-z]/.test(formData.password) && /[A-Z]/.test(formData.password)
                            ? "text-green-600"
                            : "text-gray-500"
                        }
                      >
                        Upper & lowercase letters
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {/\d/.test(formData.password) ? (
                        <Check className="w-3 h-3 text-green-600" />
                      ) : (
                        <X className="w-3 h-3 text-gray-400" />
                      )}
                      <span className={/\d/.test(formData.password) ? "text-green-600" : "text-gray-500"}>
                        At least one number
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      confirmPassword: e.target.value,
                    })
                  }
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2563EB] focus:border-transparent outline-none"
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
              {isLoading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary font-medium hover:underline">
                Sign in here
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
