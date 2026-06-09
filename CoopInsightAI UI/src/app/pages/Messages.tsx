import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLocation } from "react-router";
import { Send, Search, MessageSquare, Users, User, Reply, X, Plus } from "lucide-react";

interface Message {
  id: string;
  from: string;
  fromRole: string;
  to: string;
  subject: string;
  content: string;
  timestamp: string;
  read: boolean;
  type: "personal" | "broadcast";
  replies?: Message[];
}

export function Messages() {
  const { user } = useAuth();
  const location = useLocation();
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "personal" | "broadcast">("all");
  const [replyText, setReplyText] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [composeForm, setComposeForm] = useState({
    to: "",
    subject: "",
    content: "",
    type: "personal" as "personal" | "broadcast",
  });

  // Handle navigation state from Notifications / SecurityAudit broadcast buttons
  useEffect(() => {
    const state = location.state as { openCompose?: boolean; type?: string; prefill?: string } | null;
    if (state?.openCompose) {
      setShowCompose(true);
      setComposeForm((f) => ({
        ...f,
        type: (state.type as "personal" | "broadcast") || "broadcast",
        content: state.prefill || "",
      }));
    }
  }, [location.state]);

  const [messages] = useState<Message[]>([
    {
      id: "1",
      from: "Manager David Mugisha",
      fromRole: "manager",
      to: user?.name || "",
      subject: "Monthly Meeting Reminder",
      content: "Dear members, our monthly cooperative meeting is scheduled for May 10, 2026 at 10:00 AM at the cooperative office. Please confirm your attendance.",
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      read: false,
      type: "broadcast",
    },
    {
      id: "2",
      from: "Government Official",
      fromRole: "government",
      to: "All Cooperatives",
      subject: "Compliance Report Due",
      content: "All cooperatives in Gasabo district must submit their quarterly compliance reports by May 15, 2026. Please ensure all documents are up to date.",
      timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      read: false,
      type: "broadcast",
    },
    {
      id: "3",
      from: "Manager David Mugisha",
      fromRole: "manager",
      to: user?.name || "",
      subject: "Your Loan Application",
      content: "Your loan application for RWF 500,000 has been approved. Please visit the office to complete the paperwork.",
      timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      read: true,
      type: "personal",
      replies: [
        {
          id: "3-1",
          from: user?.name || "",
          fromRole: "member",
          to: "Manager David Mugisha",
          subject: "Re: Your Loan Application",
          content: "Thank you! I will visit the office tomorrow morning.",
          timestamp: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
          read: true,
          type: "personal",
        },
      ],
    },
  ]);

  const filteredMessages = messages.filter((msg) => {
    const matchesFilter = filter === "all" || msg.type === filter;
    const matchesSearch =
      msg.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.from.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const canReply = !!selectedMessage && !(user?.role === "member" && selectedMessage.type === "broadcast");

  const handleReply = () => {
    if (!replyText.trim()) return;
    // In a real app, this would send the reply
    console.log("Sending reply:", replyText);
    setReplyText("");
  };

  const handleSendMessage = () => {
    if (!composeForm.subject.trim() || !composeForm.content.trim()) return;
    if (composeForm.type === "personal" && !composeForm.to.trim()) return;

    // In a real app, this would send the message
    console.log("Sending message:", composeForm);
    setComposeForm({ to: "", subject: "", content: "", type: "personal" });
    setShowCompose(false);
  };

  const getRelativeTime = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Messages</h1>
          <p className="text-muted-foreground mt-1">
            {user?.role === "member"
              ? "View broadcast messages and reply to personal messages"
              : "Send and receive messages with cooperative members"}
          </p>
        </div>
        {user?.role !== "member" ? (
          <button
            onClick={() => setShowCompose(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#2D6A4F] text-white rounded-lg hover:bg-[#1B4332] transition-colors"
          >
            <Plus className="w-4 h-4" />
            {user?.role === "manager" || user?.role === "generalManager" ? "New Message / Broadcast" : "New Message"}
          </button>
        ) : (
          <span className="px-4 py-2 text-sm text-gray-500">Reply-only access for members</span>
        )}
      </div>

      {/* Compose Message Modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-border flex items-center justify-between">
              <h2 className="text-xl font-semibold text-card-foreground">Compose Message</h2>
              <button onClick={() => setShowCompose(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {user?.role !== "member" && (
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">Message Type</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value="personal"
                        checked={composeForm.type === "personal"}
                        onChange={(e) => setComposeForm({ ...composeForm, type: e.target.value as any })}
                        className="w-4 h-4 text-[#2D6A4F] focus:ring-[#2D6A4F]"
                      />
                      <span className="text-sm text-card-foreground">Personal Message</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value="broadcast"
                        checked={composeForm.type === "broadcast"}
                        onChange={(e) => setComposeForm({ ...composeForm, type: e.target.value as any })}
                        className="w-4 h-4 text-[#2D6A4F] focus:ring-[#2D6A4F]"
                      />
                      <span className="text-sm text-card-foreground">Broadcast to All Members</span>
                    </label>
                  </div>
                </div>
              )}

              {composeForm.type === "personal" && (
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">To</label>
                  <input
                    type="text"
                    value={composeForm.to}
                    onChange={(e) => setComposeForm({ ...composeForm, to: e.target.value })}
                    placeholder="Recipient name or select from members"
                    className="w-full px-4 py-2 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">Subject</label>
                <input
                  type="text"
                  value={composeForm.subject}
                  onChange={(e) => setComposeForm({ ...composeForm, subject: e.target.value })}
                  placeholder="Message subject"
                  className="w-full px-4 py-2 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">Message</label>
                <textarea
                  value={composeForm.content}
                  onChange={(e) => setComposeForm({ ...composeForm, content: e.target.value })}
                  placeholder="Type your message here..."
                  rows={8}
                  className="w-full px-4 py-2 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground resize-none"
                />
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowCompose(false)}
                  className="px-4 py-2 border border-border rounded-lg text-card-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendMessage}
                  disabled={!composeForm.subject.trim() || !composeForm.content.trim() || (composeForm.type === "personal" && !composeForm.to.trim())}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  {composeForm.type === "broadcast" ? "Broadcast Message" : "Send Message"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Message List */}
        <div className="md:col-span-1 bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages..."
                className="w-full pl-10 pr-4 py-2 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-sm text-foreground"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setFilter("all")}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  filter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter("personal")}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  filter === "personal"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Personal
              </button>
              <button
                onClick={() => setFilter("broadcast")}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  filter === "broadcast"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Broadcast
              </button>
            </div>
          </div>

          <div className="overflow-y-auto max-h-[600px]">
            {filteredMessages.length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground text-sm">No messages found</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredMessages.map((message) => (
                  <div
                    key={message.id}
                    onClick={() => setSelectedMessage(message)}
                    className={`p-4 cursor-pointer transition-colors hover:bg-muted/50 ${
                      selectedMessage?.id === message.id ? "bg-muted/30" : ""
                    } ${!message.read ? "bg-primary/5" : ""} ${
                      message.fromRole === "government" ? "border-l-4 border-accent" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                          message.fromRole === "government"
                            ? "bg-accent text-accent-foreground"
                            : message.type === "broadcast"
                            ? "bg-secondary text-secondary-foreground"
                            : "bg-primary text-primary-foreground"
                        }`}
                      >
                        {message.type === "broadcast" ? <Users className="w-5 h-5" /> : <User className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-card-foreground text-sm truncate">{message.from}</p>
                          {!message.read && <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>}
                        </div>
                        <p className="text-sm text-card-foreground font-medium truncate mb-1">{message.subject}</p>
                        <p className="text-xs text-muted-foreground truncate">{message.content}</p>
                        <p className="text-xs text-muted-foreground mt-2">{getRelativeTime(message.timestamp)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Message Detail */}
        <div className="md:col-span-2 bg-card rounded-xl border border-border overflow-hidden">
          {selectedMessage ? (
            <div className="flex flex-col h-full">
              <div className={`p-6 border-b border-border ${selectedMessage.fromRole === "government" ? "bg-accent/5 border-l-4 border-accent" : ""}`}>
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center font-medium ${
                      selectedMessage.fromRole === "government"
                        ? "bg-accent text-accent-foreground"
                        : selectedMessage.type === "broadcast"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {selectedMessage.type === "broadcast" ? <Users className="w-6 h-6" /> : <User className="w-6 h-6" />}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-card-foreground text-lg">{selectedMessage.subject}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      From: <span className="font-medium">{selectedMessage.from}</span> ({selectedMessage.fromRole})
                    </p>
                    <p className="text-sm text-muted-foreground">To: {selectedMessage.to}</p>
                    <p className="text-xs text-muted-foreground mt-2">{new Date(selectedMessage.timestamp).toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2">
                    {selectedMessage.fromRole === "government" && (
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-accent text-accent-foreground">
                        Government
                      </span>
                    )}
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        selectedMessage.type === "broadcast"
                          ? "bg-secondary/20 text-secondary-foreground"
                          : "bg-primary/20 text-primary"
                      }`}
                    >
                      {selectedMessage.type}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-6 overflow-y-auto">
                <div className="prose max-w-none">
                  <p className="text-card-foreground whitespace-pre-wrap">{selectedMessage.content}</p>
                </div>

                {selectedMessage.replies && selectedMessage.replies.length > 0 && (
                  <div className="mt-6 space-y-4">
                    <h4 className="font-semibold text-card-foreground flex items-center gap-2">
                      <Reply className="w-4 h-4" />
                      Replies
                    </h4>
                    {selectedMessage.replies.map((reply) => (
                      <div key={reply.id} className="ml-6 p-4 bg-muted rounded-lg">
                        <div className="flex items-start gap-3 mb-2">
                          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
                            {reply.from.split(" ").map((n) => n[0]).join("")}
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-sm text-card-foreground">{reply.from}</p>
                            <p className="text-xs text-muted-foreground">{new Date(reply.timestamp).toLocaleString()}</p>
                          </div>
                        </div>
                        <p className="text-sm text-card-foreground ml-11">{reply.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canReply && (
                <div className="p-6 border-t border-border">
                  <div className="flex gap-3">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type your reply..."
                      rows={3}
                      className="flex-1 px-4 py-3 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground resize-none"
                    />
                    <button
                      onClick={handleReply}
                      disabled={!replyText.trim()}
                      className="px-6 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      Send
                    </button>
                  </div>
                  {user?.role === "member" && selectedMessage.type === "broadcast" && (
                    <p className="text-xs text-muted-foreground mt-2">
                      You cannot reply to broadcast messages
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full p-8">
              <div className="text-center">
                <MessageSquare className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground">Select a message to view</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
