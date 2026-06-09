import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/Card";
import { FileText, Download, Calendar, Eye } from "lucide-react";
import { Button } from "../components/Button";
import { useAuth } from "../contexts/AuthContext";

interface Report {
  id: string;
  title: string;
  description: string;
  date: string;
  type: string;
  cooperative: string;
  status: string;
  content: {
    summary: string;
    sections: Array<{
      title: string;
      data: Array<{ label: string; value: string }>;
    }>;
    recommendations: string[];
  };
}

interface ScheduledReport {
  id: string;
  title: string;
  frequency: string;
  nextRun: string;
  status: string;
  recipients: string[];
}

const initialReports: Report[] = [
  {
    id: "1",
    title: "Monthly Financial Report",
    description: "Comprehensive financial overview for April 2026",
    date: "April 15, 2026",
    type: "Financial",
    cooperative: "Green Valley Farmers",
    status: "Ready",
    content: {
      summary: "Total revenue increased by 24% compared to March 2026. All cooperatives showed positive growth with Green Valley Farmers leading at 32% increase.",
      sections: [
        {
          title: "Revenue Breakdown",
          data: [
            { label: "Green Valley Farmers", value: "RWF 45,200" },
            { label: "Tech Innovation Hub", value: "RWF 68,900" },
            { label: "Artisan Crafts Collective", value: "RWF 32,100" },
            { label: "Dairy Producers Alliance", value: "RWF 52,800" },
            { label: "Total Revenue", value: "RWF 199,000" },
          ],
        },
        {
          title: "Expenses",
          data: [
            { label: "Operations", value: "RWF 45,600" },
            { label: "Training", value: "RWF 12,400" },
            { label: "Marketing", value: "RWF 8,900" },
            { label: "Infrastructure", value: "RWF 15,200" },
            { label: "Total Expenses", value: "RWF 82,100" },
          ],
        },
      ],
      recommendations: [
        "Allocate additional resources to Green Valley Farmers for expansion",
        "Reduce operational costs by 10% through process optimization",
        "Increase marketing budget for Artisan Crafts Collective to boost sales",
      ],
    },
  },
  {
    id: "2",
    title: "Membership Engagement Report",
    description: "Detailed member activity and engagement trends",
    date: "April 10, 2026",
    type: "Membership",
    cooperative: "Artisan Crafts Collective",
    status: "Ready",
    content: {
      summary: "Member engagement is at 82%, with 1,248 active members across all cooperatives. Training attendance has increased by 15%.",
      sections: [
        {
          title: "Engagement Metrics",
          data: [
            { label: "Active Members", value: "1,248" },
            { label: "Meeting Attendance", value: "78%" },
            { label: "Training Participation", value: "65%" },
            { label: "Contribution Rate", value: "92%" },
          ],
        },
        {
          title: "Top Contributors",
          data: [
            { label: "Michael Chen", value: "RWF 5,000" },
            { label: "David Kim", value: "RWF 3,200" },
            { label: "Maria Garcia", value: "RWF 2,800" },
            { label: "Sarah Johnson", value: "RWF 2,500" },
          ],
        },
      ],
      recommendations: [
        "Send SMS reminders to members with attendance below 60%",
        "Create incentive programs for consistent contributors",
        "Launch mentorship program pairing high performers with new members",
      ],
    },
  },
  {
    id: "3",
    title: "Activity Performance Summary",
    description: "Activity-level performance and outcomes across cooperatives",
    date: "April 5, 2026",
    type: "Activity",
    cooperative: "Dairy Producers Alliance",
    status: "Ready",
    content: {
      summary: "Overall cooperative health score is 76/100. All cooperatives are profitable with Green Valley Farmers showing the strongest performance.",
      sections: [
        {
          title: "Health Scores",
          data: [
            { label: "Green Valley Farmers", value: "85%" },
            { label: "Dairy Producers Alliance", value: "79%" },
            { label: "Tech Innovation Hub", value: "72%" },
            { label: "Artisan Crafts Collective", value: "68%" },
          ],
        },
        {
          title: "Key Performance Indicators",
          data: [
            { label: "Average Revenue Growth", value: "+18%" },
            { label: "Member Retention Rate", value: "94%" },
            { label: "New Member Acquisition", value: "+156" },
            { label: "Customer Satisfaction", value: "4.6/5" },
          ],
        },
      ],
      recommendations: [
        "Focus improvement efforts on Artisan Crafts Collective to raise health score above 75%",
        "Implement best practices from Green Valley Farmers across other cooperatives",
        "Increase production capacity for high-performing cooperatives",
      ],
    },
  },
  {
    id: "4",
    title: "Compliance Snapshot",
    description: "Regulatory compliance and reporting readiness overview",
    date: "March 31, 2026",
    type: "Compliance",
    cooperative: "Green Valley Farmers",
    status: "Ready",
    content: {
      summary: "Compliance reporting readiness remains strong. All high-priority cooperatives have submitted documentation on time.",
      sections: [
        {
          title: "Compliance Summary",
          data: [
            { label: "Cooperatives in Good Standing", value: "92%" },
            { label: "Reports Submitted", value: "18/20" },
            { label: "Pending Actions", value: "2" },
          ],
        },
        {
          title: "Risk Areas",
          data: [
            { label: "Late Audit Submissions", value: "1" },
            { label: "Registry Updates", value: "2" },
            { label: "Safety Certification", value: "0" },
          ],
        },
      ],
      recommendations: [
        "Follow up with the remaining cooperatives on registry updates",
        "Schedule safety certification reviews for at-risk cooperatives",
        "Ensure quarterly compliance reports are shared with the oversight team",
      ],
    },
  },
];

// reportStats intentionally omitted — stats shown inline

const templates = [
  { id: "financial", name: "Financial Report", description: "Revenue, expenses, and performance metrics for a selected cooperative." },
  { id: "membership", name: "Membership Report", description: "Member engagement, attendance and retention analysis." },
  { id: "activity", name: "Activity Outcomes Report", description: "Activity performance, outcomes, and resource utilization." },
  { id: "compliance", name: "Compliance Report", description: "Regulatory readiness, audit status, and risk areas." },
];

const scheduledReports: ScheduledReport[] = [
  { id: "S1", title: "Weekly Compliance Summary", frequency: "Weekly", nextRun: "2026-04-21", status: "Scheduled", recipients: ["compliance@gov.rw"] },
  { id: "S2", title: "Monthly Performance Dashboard", frequency: "Monthly", nextRun: "2026-05-01", status: "Scheduled", recipients: ["minister@gov.rw", "audit@gov.rw"] },
  { id: "S3", title: "Quarterly Member Engagement Review", frequency: "Quarterly", nextRun: "2026-06-30", status: "Scheduled", recipients: ["membership@gov.rw"] },
];

const cooperativeOptions = ["All Cooperatives", "Green Valley Farmers", "Artisan Crafts Collective", "Dairy Producers Alliance", "Tech Innovation Hub"];
const reportTypes = ["All", "Financial", "Membership", "Activity", "Compliance", "Custom"];

export function Reports() {
  const { user } = useAuth();
  const [_viewingReport, setViewingReport] = useState<Report | null>(null);
  const [reportList, setReportList] = useState<Report[]>(initialReports);
  const [activeType, setActiveType] = useState<string>("All");
  const [selectedCooperative, setSelectedCooperative] = useState<string>("All Cooperatives");
  const [dateRange, setDateRange] = useState({ start: "2026-03-01", end: "2026-04-30" });
  const [selectedTemplate, setSelectedTemplate] = useState<string>(templates[0].id);
  const [includeGraphs, setIncludeGraphs] = useState(true);
  const [includeExecutiveSummary] = useState(true);
  const [includeChatSummary, setIncludeChatSummary] = useState(true);
  const [customTitle, setCustomTitle] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customSections, setCustomSections] = useState<{ title: string; value: string }[]>([
    { title: "Executive Summary", value: "" },
  ]);
  const [customExecutiveSummary, setCustomExecutiveSummary] = useState("");
  const [showReportHistory, setShowReportHistory] = useState(false);
  const [exportFormat, setExportFormat] = useState<"txt" | "pdf" | "xlsx">("txt");

  const isReportAllAllowed =
    user?.role === "admin" || user?.role === "government" || user?.role === "generalManager";
  const effectiveSelectedCooperative =
    !isReportAllAllowed && user?.cooperativeName ? user.cooperativeName : selectedCooperative;
  const visibleCooperativeOptions = isReportAllAllowed
    ? cooperativeOptions
    : user?.cooperativeName
    ? [user.cooperativeName]
    : ["All Cooperatives"];

  useEffect(() => {
    if (!isReportAllAllowed && user?.cooperativeName) {
      setSelectedCooperative(user.cooperativeName);
    }
  }, [isReportAllAllowed, user?.cooperativeName]);

  const filteredReports = useMemo(() => {
    return reportList.filter((report) => {
      const typeMatch = activeType === "All" || report.type === activeType;
      const coopMatch =
        effectiveSelectedCooperative === "All Cooperatives"
          ? isReportAllAllowed
          : report.cooperative === effectiveSelectedCooperative;
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      const reportDate = new Date(report.date);
      const dateMatch = reportDate >= startDate && reportDate <= endDate;
      return typeMatch && coopMatch && dateMatch;
    });
  }, [activeType, effectiveSelectedCooperative, dateRange, reportList, isReportAllAllowed]);

  const archivedReports = [
    { ...initialReports[0], id: "A1", title: "Q1 2026 Audit Summary", date: "2026-03-31", status: "Archived" },
    { ...initialReports[1], id: "A2", title: "December 2025 Member Review", date: "2025-12-22", status: "Archived" },
  ];

  const downloadReport = (report: Report, format: "txt" | "pdf" | "xlsx" = "txt") => {
    const reportText = `
${report.title}
Generated: ${report.date}
Type: ${report.type}
Cooperative: ${report.cooperative}

EXECUTIVE SUMMARY
${report.content.summary}

${report.content.sections
      .map(
        (section) => `
${section.title.toUpperCase()}
${section.data.map((item) => `${item.label}: ${item.value}`).join("\n")}`
      )
      .join("\n")}

RECOMMENDATIONS
${report.content.recommendations.map((rec, i) => `${i + 1}. ${rec}`).join("\n")}
    `.trim();

    const blob = new Blob([reportText], {
      type: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : format === "pdf" ? "application/pdf" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.title.replace(/\s+/g, "_")}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const generateExecutiveSummary = () => {
    const header = customTitle || "Custom Report";
    const overview = customDescription
      ? `${customDescription.trim()}`
      : "This custom report provides a tailored cooperative view.";
    const sectionDetails = customSections
      .filter((section) => section.title && section.value)
      .map((section) => `${section.title}: ${section.value}`)
      .join(" ");

    const summary = `${header}. ${overview} ${sectionDetails}`;
    setCustomExecutiveSummary(summary);
    return summary;
  };

  const handleCreateCustomReport = () => {
    if (!customTitle) return;

    const reportCooperative = effectiveSelectedCooperative === "All Cooperatives" ? "Portfolio" : effectiveSelectedCooperative;
    const summaryText = customExecutiveSummary || generateExecutiveSummary();
    const newReport: Report = {
      id: `${reportList.length + 1}`,
      title: customTitle,
      description: customDescription || "Custom report generated from user inputs.",
      date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      type: "Custom",
      cooperative: reportCooperative,
      status: "Generated",
      content: {
        summary: summaryText,
        sections: customSections
          .filter((section) => section.title && section.value)
          .map((section) => ({ title: section.title, data: [{ label: section.title, value: section.value }] })),
        recommendations: ["Review the custom report and refine it with your management team."],
      },
    };

    setReportList([newReport, ...reportList]);
    setCustomTitle("");
    setCustomDescription("");
    setCustomSections([{ title: "Executive Summary", value: "" }]);
    setCustomExecutiveSummary("");
  };

  const addCustomSection = () => {
    setCustomSections((prev) => [...prev, { title: "", value: "" }]);
  };

  const updateCustomSection = (index: number, field: "title" | "value", value: string) => {
    setCustomSections((prev) =>
      prev.map((section, idx) => (idx === index ? { ...section, [field]: value } : section))
    );
  };

  const handleGenerateReport = () => {
    const template = templates.find((item) => item.id === selectedTemplate);
    if (!template) return;

    const reportCooperative =
      effectiveSelectedCooperative === "All Cooperatives" ? "Portfolio" : effectiveSelectedCooperative;

    const newReport: Report = {
      id: `${reportList.length + 1}`,
      title: `${template.name} - ${reportCooperative}`,
      description: template.description,
      date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      type: template.name === "Financial Report" ? "Financial" : template.name === "Membership Report" ? "Membership" : template.name === "Activity Outcomes Report" ? "Activity" : "Compliance",
      cooperative: reportCooperative,
      status: "Generated",
      content: {
        summary: includeExecutiveSummary
          ? `Generated executive summary for ${template.name.toLowerCase()} with optional chart and chat content.`
          : "Executive summary not included.",
        sections: [
          {
            title: "Template Overview",
            data: [
              { label: "Template", value: template.name },
              { label: "Cooperative", value: reportCooperative },
              { label: "Charts Included", value: includeGraphs ? "Yes" : "No" },
              { label: "Chat Summary", value: includeChatSummary ? "Enabled" : "Disabled" },
            ],
          },
        ],
        recommendations: [
          `Use the ${template.name.toLowerCase()} to brief management and regulators.`,
          "Share the report in PDF or Excel format for executive review.",
        ],
      },
    };

    setReportList([newReport, ...reportList]);
  };

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-600 mt-2">Generate, filter, export, and schedule cooperative reports.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => handleGenerateReport()}>
            <FileText className="w-4 h-4 mr-2" />
            Generate Report
          </Button>
        </div>
      </div>

      <Card className="p-6 mb-8">
        <div className="grid gap-4 xl:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Report Type</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              value={activeType}
              onChange={(event) => setActiveType(event.target.value)}
            >
              {reportTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Cooperative Filter</label>
            {isReportAllAllowed ? (
              <select
                className="w-full rounded-lg border border-gray-300 px-4 py-3"
                value={selectedCooperative}
                onChange={(event) => setSelectedCooperative(event.target.value)}
              >
                {visibleCooperativeOptions.map((cooperative) => (
                  <option key={cooperative} value={cooperative}>
                    {cooperative}
                  </option>
                ))}
              </select>
            ) : (
              <div className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-gray-700">
                {user?.cooperativeName || "My Cooperative"}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              value={dateRange.start}
              onChange={(event) => setDateRange({ ...dateRange, start: event.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              value={dateRange.end}
              onChange={(event) => setDateRange({ ...dateRange, end: event.target.value })}
            />
          </div>
        </div>
      </Card>

      <Card className="p-6 mb-8">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Template</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              value={selectedTemplate}
              onChange={(event) => setSelectedTemplate(event.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="graphs"
              checked={includeGraphs}
              onChange={(event) => setIncludeGraphs(event.target.checked)}
              className="h-4 w-4 text-[#2D6A4F] border-gray-300 rounded"
            />
            <label htmlFor="graphs" className="text-sm text-gray-700">
              Include charts & graphs
            </label>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="chatSummary"
              checked={includeChatSummary}
              onChange={(event) => setIncludeChatSummary(event.target.checked)}
              className="h-4 w-4 text-[#2D6A4F] border-gray-300 rounded"
            />
            <label htmlFor="chatSummary" className="text-sm text-gray-700">
              Include AI chat summary
            </label>
          </div>
        </div>
      </Card>

      {includeGraphs && (
        <Card className="p-6 mb-8">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Charts & Graphs</h2>
                <p className="text-sm text-gray-600">Visual report summaries for the selected cooperative.</p>
              </div>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                {effectiveSelectedCooperative}
              </span>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-3xl border border-gray-200 bg-white p-4">
                <p className="text-sm text-gray-500 mb-4">Revenue Trend</p>
                <div className="flex items-end gap-2 h-24">
                  <span className="h-12 w-full rounded-full bg-[#2D6A4F]/20"></span>
                  <span className="h-16 w-full rounded-full bg-[#2D6A4F]/30"></span>
                  <span className="h-20 w-full rounded-full bg-[#2D6A4F]/40"></span>
                  <span className="h-14 w-full rounded-full bg-[#2D6A4F]/25"></span>
                </div>
              </div>
              <div className="rounded-3xl border border-gray-200 bg-white p-4">
                <p className="text-sm text-gray-500 mb-4">Expense Breakdown</p>
                <div className="space-y-3">
                  <div className="h-3 w-full rounded-full bg-gray-200"><div className="h-3 w-[72%] rounded-full bg-[#2563EB]" /></div>
                  <div className="h-3 w-full rounded-full bg-gray-200"><div className="h-3 w-[48%] rounded-full bg-[#f97316]" /></div>
                  <div className="h-3 w-full rounded-full bg-gray-200"><div className="h-3 w-[36%] rounded-full bg-[#e11d48]" /></div>
                </div>
              </div>
              <div className="rounded-3xl border border-gray-200 bg-white p-4">
                <p className="text-sm text-gray-500 mb-4">Performance Score</p>
                <div className="rounded-3xl bg-slate-100 p-6 text-center">
                  <p className="text-4xl font-bold text-slate-900">86%</p>
                  <p className="text-sm text-gray-500">Aggregate cooperative health</p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3 mb-8">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Template Generator</h2>
          <p className="text-sm text-gray-600 mb-4">Use the selected template to generate a new report with optional charts and executive summary.</p>
          <Button onClick={handleGenerateReport} className="w-full">
            <FileText className="w-4 h-4 mr-2" />
            Generate New Report
          </Button>
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Export Options</h2>
          <div className="space-y-3">
            {(["txt", "pdf", "xlsx"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setExportFormat(option)}
                className={`w-full text-left rounded-lg border px-4 py-3 ${
                  exportFormat === option ? "border-[#2D6A4F] bg-[#2D6A4F]/10" : "border-gray-200 bg-white"
                }`}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Scheduled Reports</h2>
          <div className="space-y-3">
            {scheduledReports.map((schedule) => (
              <div key={schedule.id} className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium text-gray-900">{schedule.title}</p>
                  <span className="text-xs text-gray-500">{schedule.frequency}</span>
                </div>
                <p className="text-sm text-gray-600">Next Run: {schedule.nextRun}</p>
                <p className="text-sm text-gray-600">Recipients: {schedule.recipients.join(", ")}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-6 mb-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Custom Report Builder</h2>
            <p className="text-sm text-gray-600 mb-4">Create a custom report with your own sections, summary, and recommendations.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Report Title</label>
                <input
                  value={customTitle}
                  onChange={(event) => setCustomTitle(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3"
                  placeholder="Enter a custom report title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={customDescription}
                  onChange={(event) => setCustomDescription(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3"
                  rows={4}
                  placeholder="Add a brief overview for the custom report"
                />
              </div>
              <div className="space-y-3">
                {customSections.map((section, index) => (
                  <div key={index} className="rounded-xl border border-gray-200 p-4 bg-slate-50">
                    <div className="grid gap-3 sm:grid-cols-[0.4fr_1fr]">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Section Title</label>
                        <input
                          value={section.title}
                          onChange={(event) => updateCustomSection(index, "title", event.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-4 py-3"
                          placeholder="Section title"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Section Data</label>
                        <input
                          value={section.value}
                          onChange={(event) => updateCustomSection(index, "value", event.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-4 py-3"
                          placeholder="Key figures, insights, or commentary"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="secondary" onClick={addCustomSection} className="w-full sm:w-auto">
                  Add Section
                </Button>
                <Button onClick={generateExecutiveSummary} className="w-full sm:w-auto">
                  Generate Executive Summary
                </Button>
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Executive Summary Preview</h3>
            <div className="rounded-2xl bg-slate-50 p-4 min-h-[220px] text-sm text-gray-700">
              {customExecutiveSummary ? (
                <p>{customExecutiveSummary}</p>
              ) : (
                <p className="text-gray-500">Generate a summary to preview how the report will position key insights and recommendations.</p>
              )}
            </div>
            <div className="mt-6 space-y-3">
              <Button className="w-full" onClick={handleCreateCustomReport}>
                Create Custom Report
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => setCustomExecutiveSummary(generateExecutiveSummary())}>
                Refresh Summary
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Report Library</h2>
          <p className="text-sm text-gray-500">Showing {filteredReports.length} report(s) based on current filters.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowReportHistory(!showReportHistory)}
          className="text-sm text-[#2D6A4F] hover:text-[#1b4332]"
        >
          {showReportHistory ? "Hide" : "Show"} History Archive
        </button>
      </div>

      <Card className="overflow-hidden mb-8">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Available Reports</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {filteredReports.map((report) => (
            <div key={report.id} className="p-6 hover:bg-gray-50 transition-colors">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-4 flex-1">
                  <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-6 h-6 text-gray-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">{report.title}</h3>
                    <p className="text-sm text-gray-600 mb-2">{report.description}</p>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {report.date}
                      </span>
                      <span className="px-2 py-1 bg-[#2D6A4F]/10 text-[#2D6A4F] rounded-md text-xs font-medium">
                        {report.type}
                      </span>
                      <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-md text-xs font-medium">
                        {report.cooperative}
                      </span>
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded-md text-xs font-medium">
                        {report.status}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setViewingReport(report)}>
                    <Eye className="w-4 h-4 mr-2" />
                    View
                  </Button>
                  <Button onClick={() => downloadReport(report, exportFormat)}>
                    <Download className="w-4 h-4 mr-2" />
                    Export {exportFormat.toUpperCase()}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {showReportHistory && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Report History Archive</h3>
            <span className="text-sm text-gray-500">Last updated: April 5, 2026</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {archivedReports.map((history) => (
              <div key={history.id} className="rounded-xl border border-gray-200 p-5 bg-white">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm text-gray-500">{history.date}</p>
                    <h4 className="text-lg font-semibold text-gray-900">{history.title}</h4>
                  </div>
                  <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-md text-xs font-medium">
                    {history.status}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-4">{history.description}</p>
                <Button variant="secondary" onClick={() => setViewingReport(history)}>
                  <Eye className="w-4 h-4 mr-2" />
                  View Archive
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
