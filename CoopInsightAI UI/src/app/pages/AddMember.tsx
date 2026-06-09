import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";

interface Member {
  id: string;
  name: string;
  role: string;
  contribution: string;
  cooperative: string;
  phone: string;
}

const cooperativeOptions = [
  { value: "", label: "Select a cooperative" },
  { value: "Green Valley Farmers", label: "Green Valley Farmers" },
  { value: "Sunrise Dairy Cooperative", label: "Sunrise Dairy Cooperative" },
  { value: "Artisan Crafts Collective", label: "Artisan Crafts Collective" },
  { value: "Dairy Producers Alliance", label: "Dairy Producers Alliance" },
];

export function AddMember() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: "",
    role: "",
    contribution: "",
    cooperative: user?.cooperativeName || "",
    phone: "",
  });
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.role || !formData.contribution || !formData.cooperative || !formData.phone) {
      setError("Please complete all fields before continuing.");
      return;
    }

    if (user?.role === "manager" && user.cooperativeName && formData.cooperative !== user.cooperativeName) {
      setError(`Managers can only add members to their own cooperative (${user.cooperativeName}).`);
      return;
    }

    const storedMembers = localStorage.getItem("coopinsight_members");
    const members: Member[] = storedMembers ? JSON.parse(storedMembers) : [];

    const newMember: Member = {
      id: Date.now().toString(),
      name: formData.name,
      role: formData.role,
      contribution: `RWF{formData.contribution.replace(/[^0-9]/g, "")}`,
      cooperative: formData.cooperative,
      phone: formData.phone,
    };

    localStorage.setItem("coopinsight_members", JSON.stringify([newMember, ...members]));
    navigate("/members");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Add Member</h1>
        <p className="text-gray-600 mt-1">Create a new member record for the cooperative.</p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>}

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
              label="Contribution"
              placeholder="e.g., 2,500"
              value={formData.contribution}
              onChange={(e) => setFormData({ ...formData, contribution: e.target.value })}
              required
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

          <div>
            <Select
              label="Cooperative"
              options={cooperativeOptions}
              value={formData.cooperative}
              onChange={(e) => setFormData({ ...formData, cooperative: e.target.value })}
              required
            />
            {user?.role === "manager" && user.cooperativeName && (
              <p className="mt-2 text-sm text-gray-500">You are currently assigned to {user.cooperativeName}. Managers can only add members to this cooperative.</p>
            )}
          </div>

          <div className="flex gap-3">
            <Button type="submit">Create Member</Button>
            <Button type="button" variant="secondary" onClick={() => navigate("/members")}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
