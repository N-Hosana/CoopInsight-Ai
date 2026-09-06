import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Select } from "../components/Select";
import { useAuth } from "../contexts/AuthContext";
import { Plus, UserCircle, Search, Download } from "lucide-react";
import { api } from "../services/api";

interface Member {
  id: string;
  name: string;
  role: string;
  contribution: string;
  cooperative: string;
  cooperativeId: string;
  phone: string;
  email: string;
  nationalId: string;
  joinDate?: string;
  status?: "Active" | "Inactive" | "Suspended";
}

interface CooperativeOption {
  value: string;
  label: string;
}

const statusOptions = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suspended", label: "Suspended" },
];

export function Members() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCooperative, setFilterCooperative] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [cooperativeOptions, setCooperativeOptions] = useState<CooperativeOption[]>([
    { value: "", label: "All cooperatives" },
  ]);

  useEffect(() => {
    api
      .get<any>("/cooperatives?page=1&limit=100")
      .then((res: any) => {
        const data = res?.data ?? [];
        setCooperativeOptions([
          { value: "", label: "All cooperatives" },
          ...data.map((c: any) => ({ value: String(c.id), label: c.name })),
        ]);
      })
      .catch(() => {
        // Keep the default "All cooperatives" option on failure
      });
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", "100");
      if (searchTerm) params.set("search", searchTerm);
      if (filterCooperative) params.set("cooperativeId", filterCooperative);
      if (filterStatus) params.set("status", filterStatus);

      const response = await api.get<any>(`/members?${params.toString()}`);
      const data = response?.data ?? [];
      const list = Array.isArray(data) ? data : response?.data ?? [];

      const statusLabels: Record<string, "Active" | "Inactive" | "Suspended"> = {
        active: "Active",
        inactive: "Inactive",
        suspended: "Suspended",
      };

      const mapped: Member[] = (list as any[]).map((m: any) => ({
        id: String(m.id),
        name: m.full_name || m.name || "",
        role: m.role || "member",
        contribution: m.total_contributions != null
          ? `RWF ${Number(m.total_contributions).toLocaleString()}`
          : "RWF 0",
        cooperative: m.cooperative_name || "",
        cooperativeId: m.cooperative_id ? String(m.cooperative_id) : "",
        phone: m.phone || "",
        email: m.email || "",
        nationalId: m.national_id || "",
        joinDate: m.membership_date || m.join_date || undefined,
        status: statusLabels[m.status as string],
      }));

      setMembers(mapped);
      setTotalCount(response?.pagination?.total ?? mapped.length);
    } catch (error) {
      console.error("Failed to fetch members:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, filterCooperative, filterStatus]);

  const handleBulkExport = () => {
    const csv = [
      ["Member ID", "Name", "Role", "Email", "Phone", "Cooperative", "Status", "Join Date", "Contribution"],
      ...members.map((m) => [
        m.id,
        m.name,
        m.role,
        m.email,
        m.phone,
        m.cooperative,
        m.status || "Active",
        m.joinDate || "N/A",
        m.contribution,
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `members-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1440px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Members Directory</h1>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleBulkExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          {(user?.role === "manager" || user?.role === "admin") && (
            <Button onClick={() => navigate("/members/new")}>
              <Plus className="w-4 h-4 inline-block mr-2" />
              Add Member
            </Button>
          )}
        </div>
      </div>

      <Card className="p-6">
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, email, phone, or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2563EB] outline-none"
            />
          </div>
          <Select
            label="Cooperative"
            options={cooperativeOptions}
            value={filterCooperative}
            onChange={(e) => setFilterCooperative(e.target.value)}
          />
          <Select
            label="Status"
            options={statusOptions}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          />
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Showing {members.length} of {totalCount} members
        </p>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading members...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Member
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Join Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contribution
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {members.map((member) => (
                  <tr
                    key={member.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/members/${member.id}`)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                          <UserCircle className="w-6 h-6 text-gray-500" />
                        </div>
                        <div>
                          <span className="text-sm font-medium text-gray-900">{member.name}</span>
                          <p className="text-xs text-gray-500">{member.nationalId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{member.role}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-700">{member.phone}</div>
                      <div className="text-xs text-gray-500">{member.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {member.joinDate ? new Date(member.joinDate).toLocaleDateString() : "N/A"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-3 py-1 text-xs font-medium rounded-full ${
                          member.status === "Active"
                            ? "bg-green-100 text-green-800"
                            : member.status === "Suspended"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {member.status || "Active"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{member.contribution}</td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      No members found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
