import { useState } from "react";
import { useNavigate } from "react-router";
import { useDataEntryCooperative } from "../components/DataEntryCooperative";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { api } from "../services/api";

/**
 * Planning an activity — or recording one that has already happened.
 *
 * The form used to post `scheduled_date` and `cooperative_id` where the backend
 * requires `date` (and takes the cooperative from the manager's account), and
 * offered types the backend does not accept, so no activity could be created.
 * After saving, the manager goes straight to the activity's register to record
 * who was invited and who came.
 */

const TYPES = [
  { id: "meeting", label: "Meeting or general assembly" },
  { id: "training", label: "Training" },
  { id: "production", label: "Production" },
  { id: "sales", label: "Sales" },
  { id: "distribution", label: "Distribution" },
  { id: "planning", label: "Planning" },
];

export function CreateActivity() {
  const navigate = useNavigate();
  const target = useDataEntryCooperative();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    title: "",
    type: "",
    date: "",
    startTime: "",
    endTime: "",
    location: "",
    description: "",
    budget: "",
    alreadyDone: false,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!target.cooperativeId) {
      setError("Choose the cooperative this activity belongs to.");
      return;
    }
    if (!form.title.trim() || !form.type || !form.date) {
      setError("Title, type and date are required.");
      return;
    }
    if (form.alreadyDone && form.date > today) {
      setError("An activity that has already happened cannot have a future date.");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post<{ data: { id: string } }>("/activities", {
        cooperativeId: target.cooperativeId,
        title: form.title.trim(),
        type: form.type,
        date: form.date,
        startTime: form.startTime || undefined,
        endTime: form.endTime || undefined,
        location: form.location.trim() || undefined,
        description: form.description.trim() || undefined,
        budget: form.budget ? Number(form.budget) : undefined,
      });
      const id = res.data.id;
      // A new activity starts as planned; one being recorded after the fact is
      // marked done so its attendance can be entered.
      if (form.alreadyDone) {
        await api.patch(`/activities/${id}/status`, { status: "completed" });
      }
      navigate(`/activities/${id}`);
    } catch (err: any) {
      setError(err?.message ?? "Failed to create the activity. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!target.allowed) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <h1 className="text-3xl font-bold text-gray-900">Create activity</h1>
        <p className="text-gray-600 mt-2">Activities are recorded by the cooperative's manager.</p>
      </div>
    );
  }

  const field =
    "w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent bg-white";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Create activity</h1>
        <p className="text-gray-600 mt-1">
          Plan an activity for your cooperative, or record one that has already taken place. You
          will record who attended on the next screen.
        </p>
      </div>

      {target.picker}

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>}

          <Input label="Title *" placeholder="e.g. Ordinary general assembly — October"
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={field} required>
              <option value="">Select a type</option>
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {form.type === "meeting" && (
              <p className="mt-1 text-xs text-gray-500">
                The ordinary general assemblies are due in March and October. Record each one as a
                meeting in that month and mark it done — the audit counts them.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Date *" type="date" value={form.date}
              max={form.alreadyDone ? today : undefined}
              onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            <Input label="Starts" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            <Input label="Ends" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.alreadyDone} onChange={(e) => setForm({ ...form, alreadyDone: e.target.checked })} />
            This activity has already taken place — record it as done
          </label>

          <Input label="Location" placeholder="e.g. Cooperative hall, Remera"
            value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4} className={field} placeholder="What it is for, what was decided or done" />
          </div>

          <Input label="Budget (RWF)" type="number" min={0} value={form.budget}
            onChange={(e) => setForm({ ...form, budget: e.target.value })} />

          <div className="flex gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : form.alreadyDone ? "Record and take attendance" : "Create and invite members"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate("/activities")} disabled={loading}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
