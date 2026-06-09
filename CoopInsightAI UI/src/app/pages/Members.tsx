import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { useAuth } from "../contexts/AuthContext";
import { Plus, UserCircle, Search, Download } from "lucide-react";

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
  status?: "Active" | "Probation" | "Inactive";
}

const initialMembers: Member[] = [
  {
    id: "member-1",
    name: "Sarah Johnson",
    role: "Producer",
    contribution: "RWF 2,500",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    phone: "+250788123456",
    email: "sarah@greenvalley.coop",
    nationalId: "1199212345678904",
    joinDate: "2024-02-15",
    status: "Active",
  },
  {
    id: "member-2",
    name: "Michael Chen",
    role: "Manager",
    contribution: "RWF 5,000",
    cooperative: "Tech Innovation Hub",
    cooperativeId: "coop-2",
    phone: "+250788234567",
    email: "michael@sunrise.coop",
    nationalId: "1199312345678905",
    joinDate: "2024-01-10",
    status: "Active",
  },
  {
    id: "member-3",
    name: "Emily Rodriguez",
    role: "Artisan",
    contribution: "RWF 1,800",
    cooperative: "Artisan Crafts Collective",
    cooperativeId: "coop-3",
    phone: "+250788345678",
    email: "emily@oceanview.coop",
    nationalId: "1199412345678906",
    joinDate: "2023-08-20",
    status: "Active",
  },
  {
    id: "member-4",
    name: "David Kim",
    role: "Producer",
    contribution: "RWF 3,200",
    cooperative: "Dairy Producers Alliance",
    cooperativeId: "coop-4",
    phone: "+250788456789",
    email: "david@dairyalliance.coop",
    nationalId: "1199512345678907",
    joinDate: "2023-05-12",
    status: "Active",
  },
  {
    id: "member-5",
    name: "Lisa Thompson",
    role: "Coordinator",
    contribution: "RWF 2,100",
    cooperative: "Green Valley Farmers",
    cooperativeId: "coop-1",
    phone: "+250788567890",
    email: "lisa@greenvalley.coop",
    nationalId: "1199612345678908",
    joinDate: "2023-05-10",
    status: "Active",
  },
  {
    id: "member-6",
    name: "James Wilson",
    role: "Developer",
    contribution: "RWF 4,500",
    cooperative: "Tech Innovation Hub",
    cooperativeId: "coop-2",
    phone: "+250788678901",
    email: "james@techhub.coop",
    nationalId: "1199712345678909",
    joinDate: "2023-03-15",
    status: "Probation",
  },
];

const cooperativeOptions = [
  { value: "", label: "All cooperatives" },
  { value: "Green Valley Farmers", label: "Green Valley Farmers" },
  { value: "Tech Innovation Hub", label: "Tech Innovation Hub" },
  { value: "Artisan Crafts Collective", label: "Artisan Crafts Collective" },
  { value: "Dairy Producers Alliance", label: "Dairy Producers Alliance" },
];

const statusOptions = [
  { value: "", label: "All statuses" },
  { value: "Active", label: "Active" },
  { value: "Probation", label: "Probation" },
  { value: "Inactive", label: "Inactive" },
];

export function Members() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>(() => {
    const saved = localStorage.getItem("coopinsight_members");
    return saved ? JSON.parse(saved) : initialMembers;
  });
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCooperative, setFilterCooperative] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    role: "",
    contribution: "",
    cooperative: "",
    cooperativeId: "",
    phone: "",
    email: "",
    nationalId: "",
    joinDate: new Date().toISOString().split("T")[0],
    status: "Active" as "Active" | "Probation" | "Inactive",
  });

  const visibleMembers = useMemo(() => {
    let filtered = [...members];

    if (user?.role === "member") {
      filtered = filtered.filter((member) => member.id === user.id);
    } else if (user?.role === "manager") {
      filtered = filtered.filter((member) => member.cooperativeId === user.cooperativeId);
    }

    if (searchTerm) {
      filtered = filtered.filter(
        (member) =>
          member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          member.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          member.phone.includes(searchTerm) ||
          member.nationalId.includes(searchTerm)
      );
    }

    if (filterCooperative) {
      filtered = filtered.filter((member) => member.cooperative === filterCooperative);
    }

    if (filterStatus) {
      filtered = filtered.filter((member) => member.status === filterStatus);
    }

    return filtered;
  }, [members, user, searchTerm, filterCooperative, filterStatus]);

  useEffect(() => {
    localStorage.setItem("coopinsight_members", JSON.stringify(members));
  }, [members]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newMember: Member = {
      id: `member-${Date.now()}`,
      name: formData.name,
      role: formData.role,
      contribution: `RWF ${formData.contribution.replace(/[^0-9]/g, "")}`,
      cooperative: formData.cooperative,
      cooperativeId:
        formData.cooperative === "Green Valley Farmers"
          ? "coop-1"
          : formData.cooperative === "Tech Innovation Hub"
          ? "coop-2"
          : formData.cooperative === "Artisan Crafts Collective"
          ? "coop-3"
          : formData.cooperative === "Dairy Producers Alliance"
          ? "coop-4"
          : "",
      phone: formData.phone,
      email: formData.email,
      nationalId: formData.nationalId,
      joinDate: formData.joinDate,
      status: formData.status,
    };

    setMembers([newMember, ...members]);
    setFormData({
      name: "",
      role: "",
      contribution: "",
      cooperative: "",
      cooperativeId: "",
      phone: "",
      email: "",
      nationalId: "",
      joinDate: new Date().toISOString().split("T")[0],
      status: "Active",
    });
    setShowForm(false);
  };

  const handleBulkExport = () => {
    const csv = [
      ["Member ID", "Name", "Role", "Email", "Phone", "Cooperative", "Status", "Join Date", "Contribution"],
      ...visibleMembers.map((m) => [
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
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus className="w-4 h-4 inline-block mr-2" />
              Add Member
            </Button>
          )}
        </div>
      </div>

      {showForm && (user?.role === "manager" || user?.role === "admin") && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Add New Member</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Member Name"
                placeholder="Enter full name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              <Input
                label="Role"
                placeholder="e.g., Producer, Manager, Coordinator"
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                required
              />
              <Input
                label="Email"
                placeholder="member@example.coop"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
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
              <Input
                label="National ID"
                placeholder="1199XXXXXXXXXXXX"
                value={formData.nationalId}
                onChange={(e) => setFormData({ ...formData, nationalId: e.target.value })}
                required
              />
              <Input
                label="Contribution"
                placeholder="e.g., 2500"
                value={formData.contribution}
                onChange={(e) => setFormData({ ...formData, contribution: e.target.value })}
                required
              />
              <Input
                label="Join Date"
                type="date"
                value={formData.joinDate}
                onChange={(e) => setFormData({ ...formData, joinDate: e.target.value })}
                required
              />
              <Select
                label="Status"
                options={[
                  { value: "Active", label: "Active" },
                  { value: "Probation", label: "Probation" },
                  { value: "Inactive", label: "Inactive" },
                ]}
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                required
              />
              <Select
                label="Cooperative"
                options={cooperativeOptions}
                value={formData.cooperative}
                onChange={(e) => setFormData({ ...formData, cooperative: e.target.value })}
                required
              />
            </div>
            <div className="flex gap-3">
              <Button type="submit">Submit</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

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
          Showing {visibleMembers.length} of {members.length} members
        </p>

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
              {visibleMembers.map((member) => (
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
                          : member.status === "Probation"
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
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

