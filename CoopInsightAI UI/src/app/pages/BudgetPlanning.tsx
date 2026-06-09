import { useMemo, useState } from "react";
import { ArrowLeft, Plus, Download } from "lucide-react";
import { Button } from "../components/Button";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router";
import { formatFrw } from "../data/financialData";

export function BudgetPlanning() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const cooperativeName = user?.cooperativeName || "My Cooperative";
  const [planName, setPlanName] = useState(`${cooperativeName} Budget Plan`);
  const [planPeriod, setPlanPeriod] = useState("Q3 2026");
  const [planStatus, setPlanStatus] = useState("Draft");
  const [budgetLines, setBudgetLines] = useState([
    { category: "Operations", allocated: 4200000, projected: 3800000, notes: "Facility upkeep and materials" },
    { category: "Training", allocated: 1500000, projected: 1300000, notes: "Member skills and training events" },
    { category: "Member Support", allocated: 900000, projected: 760000, notes: "Loan subsidies and savings support" },
  ]);
  const [newCategory, setNewCategory] = useState("");
  const [newAllocated, setNewAllocated] = useState("");
  const [newProjected, setNewProjected] = useState("");
  const [newNotes, setNewNotes] = useState("");

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

  const handleAddBudgetLine = () => {
    if (!newCategory || !newAllocated || !newProjected) return;
    setBudgetLines((prev) => [
      ...prev,
      {
        category: newCategory,
        allocated: parseFloat(newAllocated),
        projected: parseFloat(newProjected),
        notes: newNotes.trim() || "",
      },
    ]);
    setNewCategory("");
    setNewAllocated("");
    setNewProjected("");
    setNewNotes("");
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
          <Button onClick={handleAddBudgetLine}>
            <Plus className="w-4 h-4 mr-2" />
            Add Line
          </Button>
        </div>
      </div>

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
            <Button onClick={handleAddBudgetLine} className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add Budget Line
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
