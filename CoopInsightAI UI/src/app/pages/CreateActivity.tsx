import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/Button";
import { Input } from "../components/Input";

interface Activity {
  id: string;
  type: string;
  amount: string;
  description: string;
  date: string;
}

export function CreateActivity() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [formData, setFormData] = useState({ type: "", amount: "", description: "", date: "" });
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.type || !formData.amount || !formData.description || !formData.date) {
      setError("Please fill in all activity fields.");
      return;
    }

    const storedActivities = localStorage.getItem("coopinsight_activities");
    const activities: Activity[] = storedActivities ? JSON.parse(storedActivities) : [];

    const newActivity: Activity = {
      id: Date.now().toString(),
      type: formData.type,
      amount: `₣${formData.amount.replace(/[^0-9]/g, "")}`,
      description: formData.description,
      date: formData.date,
    };

    localStorage.setItem("coopinsight_activities", JSON.stringify([newActivity, ...activities]));
    navigate("/activities");
  };

  if (user?.role === "member" || user?.role === "government") {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <h1 className="text-3xl font-bold text-gray-900">Create Activity</h1>
        <p className="text-gray-600 mt-2">You do not have permission to create activities.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Create Activity</h1>
        <p className="text-gray-600 mt-1">Add an activity and publish it for your cooperative.</p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>}

          <Input
            label="Activity Type"
            placeholder="e.g., Production, Distribution, Meeting"
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            required
          />
          <Input
            label="Amount"
            placeholder="e.g., 2500"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            required
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent text-foreground"
              placeholder="Enter activity description"
              required
            />
          </div>
          <Input
            label="Date"
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            required
          />

          <div className="flex gap-3">
            <Button type="submit">Create Activity</Button>
            <Button type="button" variant="secondary" onClick={() => navigate("/activities")}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
