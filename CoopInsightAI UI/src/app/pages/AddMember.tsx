import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";

interface CooperativeOption {
  value: string;
  label: string;
}

export function AddMember() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    nationalId: "",
    role: "",
    cooperativeId: "",
    joinDate: "",
    contributionAmount: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooperativeOptions, setCooperativeOptions] = useState<CooperativeOption[]>([
    { value: "", label: "Select a cooperative" },
  ]);

  useEffect(() => {
    api.get("/cooperatives")
      .then((res: any) => {
        const data = (res as any).data ?? [];
        const options: CooperativeOption[] = [
          { value: "", label: "Select a cooperative" },
          ...data.map((c: any) => ({ value: String(c.id), label: c.name })),
        ];
        setCooperativeOptions(options);

        // Pre-select manager's cooperative if applicable
        if (user?.role === "manager" && user.cooperativeName) {
          const match = data.find((c: any) => c.name === user.cooperativeName);
          if (match) {
            setFormData((prev) => ({ ...prev, cooperativeId: String(match.id) }));
          }
        }
      })
      .catch(() => {
        // Keep the default empty option on failure
      });
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (
      !formData.name ||
      !formData.role ||
      !formData.contributionAmount ||
      !formData.cooperativeId ||
      !formData.phone
    ) {
      setError("Please complete all required fields before continuing.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/members", {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        national_id: formData.nationalId,
        role: formData.role,
        cooperative_id: formData.cooperativeId,
        join_date: formData.joinDate,
        contribution_amount: formData.contributionAmount.replace(/[^0-9.]/g, ""),
      });

      setSuccess("Member created successfully. Redirecting…");
      setTimeout(() => navigate("/members"), 1200);
    } catch (err: any) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        "Failed to create member. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Add Member</h1>
        <p className="text-gray-600 mt-1">Create a new member record for the cooperative.</p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-700">
              {success}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Member Name"
              placeholder="Enter full name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <Input
              label="Role"
              placeholder="e.g., Producer, Coordinator"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Email"
              placeholder="member@example.com"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
            <Input
              label="Phone Number"
              placeholder="+250788123456"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="National ID"
              placeholder="Enter national ID"
              value={formData.nationalId}
              onChange={(e) => setFormData({ ...formData, nationalId: e.target.value })}
            />
            <Input
              label="Join Date"
              type="date"
              value={formData.joinDate}
              onChange={(e) => setFormData({ ...formData, joinDate: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Contribution Amount (RWF)"
              placeholder="e.g., 2500"
              value={formData.contributionAmount}
              onChange={(e) => setFormData({ ...formData, contributionAmount: e.target.value })}
              required
            />
            <div>
              <Select
                label="Cooperative"
                options={cooperativeOptions}
                value={formData.cooperativeId}
                onChange={(e) => setFormData({ ...formData, cooperativeId: e.target.value })}
                required
              />
              {user?.role === "manager" && user.cooperativeName && (
                <p className="mt-2 text-sm text-gray-500">
                  You are currently assigned to {user.cooperativeName}. Managers can only add
                  members to this cooperative.
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create Member"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate("/members")}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
