import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { api } from "../services/api";

interface FormData {
  title: string;
  type: string;
  status: string;
  scheduled_date: string;
  location: string;
  description: string;
  cooperative_id: string;
  max_participants: string;
}

export function CreateActivity() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [formData, setFormData] = useState<FormData>({
    title: "",
    type: "",
    status: "planned",
    scheduled_date: "",
    location: "",
    description: "",
    cooperative_id: user?.cooperativeId ?? "",
    max_participants: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!formData.title || !formData.type || !formData.status || !formData.scheduled_date) {
      setError("Please fill in all required fields (title, type, status, scheduled date).");
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        title: formData.title,
        type: formData.type,
        status: formData.status,
        scheduled_date: formData.scheduled_date,
        description: formData.description,
      };
      if (formData.location) payload.location = formData.location;
      if (formData.cooperative_id) payload.cooperative_id = formData.cooperative_id;
      if (formData.max_participants) payload.max_participants = Number(formData.max_participants);

      await api.post("/activities", payload);
      navigate("/activities");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Failed to create activity. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
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
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <Input
            label="Title *"
            placeholder="e.g., Annual General Meeting"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            required
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent text-foreground bg-white"
              required
            >
              <option value="">Select a type</option>
              <option value="meeting">Meeting</option>
              <option value="training">Training</option>
              <option value="community_service">Community Service</option>
              <option value="social">Social</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent text-foreground bg-white"
              required
            >
              <option value="planned">Planned</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <Input
            label="Scheduled Date *"
            type="date"
            value={formData.scheduled_date}
            onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
            required
          />

          <Input
            label="Location"
            placeholder="e.g., Community Hall, Room 3"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent text-foreground"
              placeholder="Enter activity description"
            />
          </div>

          <Input
            label="Cooperative ID"
            placeholder="e.g., coop-001"
            value={formData.cooperative_id}
            onChange={(e) => setFormData({ ...formData, cooperative_id: e.target.value })}
          />

          <Input
            label="Max Participants"
            type="number"
            placeholder="e.g., 50"
            value={formData.max_participants}
            onChange={(e) => setFormData({ ...formData, max_participants: e.target.value })}
          />

          <div className="flex gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Activity"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate("/activities")}
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
