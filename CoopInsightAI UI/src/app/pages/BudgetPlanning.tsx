import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Download } from "lucide-react";
import { Button } from "../components/Button";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router";
import { formatFrw } from "../data/financialData";
import { api } from "../services/api";

interface BudgetLine {
  id: string;
  category: string;
  allocated: number;
  spent: number;
}

interface Budget {
  id: string;
  name: string;
  total_amount: number;
  spent: number;
  period_start: string;
  period_end: string;
  status: string;
  lines: BudgetLine[];
}

interface LocalBudgetLine {
  category: string;
  allocated: number;
  projected: number;
  notes: string;
}

export function BudgetPlanning() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const cooperativeName = user?.cooperativeName || "My Cooperative";
  const cooperativeId = user?.cooperativeId;

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [planName, setPlanName] = useState(`${cooperativeName} Budget Plan`);
  const [planPeriod, setPlanPeriod] = useState("Q3 2026");
  const [planStatus, setPlanStatus] = useState("Draft");
  const [budgetLines, setBudgetLines] = useState<LocalBudgetLine[]>([]);

  const [newCategory, setNewCategory] = useState("");
  const [newAllocated, setNewAllocated] = useState("");
  const [newProjected, setNewProjected] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const fetchBudgets = async () => {
    if (!cooperativeId) return;
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/reports/budgets?cooperative_id=${cooperativeId}`);
      const data = response.data;
      const fetched: Budget[] = data.budgets || [];
      setBudgets(fetched);

      if (fetched.length > 0) {
        const first = fetched[0];
        setPlanName(first.name);
        setPlanStatus(first.status);
        setPlanPeriod(`${first.period_start} – ${first.period_end}`);
        setBudgetLines(
          (first.lines || []).map((line) => ({
            category: line.category,
            allocated: line.allocated,
            projected: line.spent,
            notes: "",
          }))
        );
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to load budgets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBudgets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooperativeId]);

  const summary = useMemo(() => {
    const totalAllocated = budgetLines.reduce((sum, line) => sum + line.allocated, 0);
    const totalProjected = budgetLines.reduce((sum, line) => sum + line.projected, 0);
    return {
      totalAllocated,
      totalProjected,
      totalVariance: totalAllocated - totalProjected,
      lineCount: budgetLines.length,
    };
  }, [budgetLines]);

  const handleAddBudgetLine = async () => {
    if (!newCategory || !newAllocated || !newProjected) return;

    const newLine: LocalBudgetLine = {
      category: newCategory,
      allocated: parseFloat(newAllocated),
      projected: parseFloat(newProjected),
      notes: newNotes.trim() || "",
    };

    setBudgetLines((prev) => [...prev, newLine]);
    setNewCategory("");
    setNewAllocated("");
    setNewProjected("");
    setNewNotes("");

    if (!cooperativeId) return;
    try {
      setSaving(true);
      const periodParts = planPeriod.split("–").map((s) => s.trim());
      const periodStart = periodParts[0] || planPeriod;
      const periodEnd = periodParts[1] || planPeriod;

      if (budgets.length > 0) {
        await api.put(`/reports/budgets/${budgets[0].id}`, {
          name: planName,
          total_amount: summary.totalAllocated + newLine.allocated,
          period_start: periodStart,
          period_end: periodEnd,
        });
      } else {
        await api.post("/reports/budgets", {
          cooperative_id: cooperativeId,
          name: planName,
          total_amount: newLine.allocated,
          period_start: periodStart,
          period_end: periodEnd,
        });
      }
      await fetchBudgets();
    } catch {
      // local state already updated; silently ignore API error for UX
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBudget = async (budgetId: string) => {
    try {
      await api.delete(`/reports/budgets/${budgetId}`);
      await fetchBudgets();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to delete budget.");
    }
  };

  const handleDownloadBudgetPlan = () => {
    const content = [`Budget Plan: ${planName}`, `Cooperative: ${cooperativeName}`, `Period: ${planPeriod}`, `Status: ${planStatus}`, "", "Budget Lines:"];
    content.push(
      ...budgetLines.map((line, index) =>
        `${index + 1}. ${line.category} — Allocated: ${formatFrw(line.allocated)}, Projected: ${formatFrw(line.projected)}, Notes: ${line.notes || "None"}`
      )
    );
    content.push("", `Total Allocated: ${formatFrw(summary.totalAllocated)}`, `Total Projected: ${formatFrw(summary.totalProjected)}`, `Variance: ${formatFrw(summary.totalVariance)}`);

    const blob = new Blob([content.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${planName.replace(/\s+/g, "_")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Button variant="secondary" onClick={() => navigate("/financials")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Financials
          </Button>
          <h1 className="mt-4 text-3xl font-bold text-gray-900">Budget Planning</h1>
          <p className="text-gray-600 mt-2">Create and manage a full cooperative budget plan for the next period.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={handleDownloadBudgetPlan}>
            <Download className="w-4 h-4 mr-2" />
            Export Plan
          </Button>
          <Button onClick={handleAddBudgetLine} disabled={saving}>
            <Plus className="w-4 h-4 mr-2" />
            Add Line
          </Button>
        </div>
      </div>

      {loading && (
        <div className="rounded-3xl border border-gray-200 bg-white p-6">
          <p className="text-gray-500 text-sm">Loading budgets...</p>
        </div>
      )}

      {error && (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {!loading && budgets.length > 1 && (
        <div className="rounded-3xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">All Budgets</h2>
          <div className="space-y-3">
            {budgets.map((budget) => (
              <div key={budget.id} className="flex items-center justify-between rounded-2xl border border-gray-200 p-4 bg-gray-50">
                <div>
                  <p className="font-medium text-gray-900">{budget.name}</p>
                  <p className="text-sm text-gray-500">{budget.period_start} – {budget.period_end} · {budget.status}</p>
                </div>
                <div className="flex items-center gap-4">
                  <p className="text-sm font-semibold text-gray-900">{formatFrw(budget.total_amount)}</p>
                  <button
                    onClick={() => handleDeleteBudget(budget.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Budget Plan Overview</h2>
          <div className="space-y-4 text-sm text-gray-700">
            <div>
              <p className="text-gray-500">Plan name</p>
              <input
                className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3"
                value={planName}
                onChange={(event) => setPlanName(event.target.value)}
              />
            </div>
            <div>
              <p className="text-gray-500">Period</p>
              <input
                className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3"
                value={planPeriod}
                onChange={(event) => setPlanPeriod(event.target.value)}
              />
            </div>
            <div>
              <p className="text-gray-500">Status</p>
              <div className="mt-2 inline-flex items-center rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                {planStatus}
              </div>
            </div>
            <div>
              <p className="text-gray-500">Cooperative</p>
              <p className="mt-2 font-semibold text-gray-900">{cooperativeName}</p>
            </div>
          </div>
        </div>
        <div className="rounded-3xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan Metrics</h2>
          <div className="space-y-4 text-sm text-gray-700">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-gray-500">Categories</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{summary.lineCount}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-gray-500">Allocated Total</p>
              <p className="mt-2 text-2xl font-semibold text-[#16a34a]">{formatFrw(summary.totalAllocated)}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-gray-500">Projected Total</p>
              <p className="mt-2 text-2xl font-semibold text-[#2563EB]">{formatFrw(summary.totalProjected)}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-gray-500">Variance</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{formatFrw(summary.totalVariance)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="rounded-3xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Budget Lines</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Allocated</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Projected</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Variance</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {budgetLines.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">No budget lines yet. Add one using the form.</td>
                  </tr>
                )}
                {budgetLines.map((line, index) => (
                  <tr key={`${line.category}-${index}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{line.category}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{formatFrw(line.allocated)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{formatFrw(line.projected)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatFrw(line.allocated - line.projected)}</td>
                    <td className="px-4 py-3 text-gray-600">{line.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Budget Line</h2>
          <div className="space-y-4 text-sm text-gray-700">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
              <input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3"
                placeholder="Example: Marketing"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Allocated</label>
              <input
                type="number"
                value={newAllocated}
                onChange={(event) => setNewAllocated(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Projected</label>
              <input
                type="number"
                value={newProjected}
                onChange={(event) => setNewProjected(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
              <textarea
                value={newNotes}
                onChange={(event) => setNewNotes(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3"
                rows={4}
                placeholder="Optional details for this budget line"
              />
            </div>
            <Button onClick={handleAddBudgetLine} className="w-full" disabled={saving}>
              <Plus className="w-4 h-4 mr-2" />
              {saving ? "Saving..." : "Add Budget Line"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
