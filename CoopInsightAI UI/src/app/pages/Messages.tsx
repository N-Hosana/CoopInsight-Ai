import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLocation } from "react-router";
import { Send, Search, MessageSquare, Users, User, Reply, X, Plus } from "lucide-react";
import { api } from "../services/api";

interface Reply {
  id: string;
  body: string;
  sender_id: string;
  sender_name: string;
  created_at: string;
}

interface Message {
  id: string;
  subject: string;
  body: string;
  type: string;
  sender_id: string;
  sender_name: string;
  recipient_id: string | null;
  recipient_name: string | null;
  created_at: string;
  read_at: string | null;
  replies: Reply[];
}

export function Messages() {
  const { user } = useAuth();
  const location = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "personal" | "broadcast">("all");
  const [replyText, setReplyText] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [sendError, setSendError] = useState("");
  const [composeForm, setComposeForm] = useState({
    receiver_id: "",
    subject: "",
    body: "",
    type: "personal" as "personal" | "broadcast",
  });
  const [userOptions, setUserOptions] = useState<{ id: string; name: string; email: string }[]>([]);

  // Fetch available recipients (all users except self)
  useEffect(() => {
    if (user?.role !== "member") {
      api.get<any>("/members?page=1&limit=100").then((res: any) => {
        const list: any[] = (res as any).data ?? [];
        setUserOptions(list.map((m: any) => ({ id: m.id, name: m.full_name ?? m.name, email: m.email ?? "" })));
      }).catch(() => {});
    }
  }, [user?.role]);

  // Handle navigation state from Notifications / SecurityAudit broadcast buttons
  useEffect(() => {
    const state = location.state as { openCompose?: boolean; type?: string; prefill?: string } | null;
    if (state?.openCompose) {
      setShowCompose(true);
      setComposeForm((f) => ({
        ...f,
        type: (state.type as "personal" | "broadcast") || "broadcast",
        body: state.prefill || "",
      }));
    }
  }, [location.state]);

  // Fetch messages from API
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        setLoading(true);
        const data = await api.get<any>("/messages?page=1&limit=20");
        setMessages((data as any).data ?? []);
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMessages();
  }, []);

  const handleSelectMessage = async (message: Message) => {
    setSelectedMessage(message);
    setReplyText("");

    // Mark as read if unread
    if (!message.read_at) {
      try {
        await api.patch(`/messages/${message.id}/read`, {});
        const now = new Date().toISOString();
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, read_at: now } : m))
        );
        setSelectedMessage((prev) => (prev?.id === message.id ? { ...prev, read_at: now } : prev));
      } catch (err) {
        console.error("Failed to mark message as read:", err);
      }
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !selectedMessage) return;
    try {
      const res = await api.post<any>(`/messages/${selectedMessage.id}/reply`, { body: replyText });
      const newReply = (res as any).data ?? res;
      setSelectedMessage((prev) =>
        prev ? { ...prev, replies: [...(prev.replies || []), newReply] } : prev
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === selectedMessage.id
            ? { ...m, replies: [...(m.replies || []), newReply] }
            : m
        )
      );
      setReplyText("");
    } catch (err) {
      console.error("Failed to send reply:", err);
    }
  };

  const handleSendMessage = async () => {
    if (!composeForm.subject.trim() || !composeForm.body.trim()) return;
    if (composeForm.type === "personal" && !composeForm.receiver_id.trim()) return;

    setSendError("");
    try {
      const payload: Record<string, unknown> = {
        type: composeForm.type,
        subject: composeForm.subject,
        body: composeForm.body,
      };
      if (composeForm.type === "personal") {
        payload.recipientId = composeForm.receiver_id;
      }
      const res = await api.post<any>("/messages", payload);
      const newMessage = (res as any).data ?? res;
      setMessages((prev) => [newMessage, ...prev]);
      setComposeForm({ receiver_id: "", subject: "", body: "", type: "personal" });
      setShowCompose(false);
    } catch (err: any) {
      setSendError(err?.message ?? "Failed to send message. Please try again.");
    }
  };

  // Determine message type for filtering
  const getMessageType = (msg: Message): "personal" | "broadcast" => {
    return msg.type === "broadcast" || !msg.recipient_id ? "broadcast" : "personal";
  };

  const filteredMessages = messages.filter((msg) => {
    const type = getMessageType(msg);
    const matchesFilter = filter === "all" || type === filter;
    const matchesSearch =
      msg.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.sender_name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const canReply =
    !!selectedMessage &&
    !(user?.role === "member" && getMessageType(selectedMessage) === "broadcast");

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
              {sendError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{sendError}</div>
              )}
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
                  <label className="block text-sm font-medium text-card-foreground mb-2">Recipient</label>
                  {userOptions.length > 0 ? (
                    <select
                      value={composeForm.receiver_id}
                      onChange={(e) => setComposeForm({ ...composeForm, receiver_id: e.target.value })}
                      className="w-full px-4 py-2 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                    >
                      <option value="">— Select recipient —</option>
                      {userOptions.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}{u.email ? ` (${u.email})` : ""}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={composeForm.receiver_id}
                      onChange={(e) => setComposeForm({ ...composeForm, receiver_id: e.target.value })}
                      placeholder="Recipient user ID"
                      className="w-full px-4 py-2 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none text-foreground"
                    />
                  )}
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
                  value={composeForm.body}
                  onChange={(e) => setComposeForm({ ...composeForm, body: e.target.value })}
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
                  disabled={
                    !composeForm.subject.trim() ||
                    !composeForm.body.trim() ||
                    (composeForm.type === "personal" && !composeForm.receiver_id.trim())
                  }
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
            {loading ? (
              <div className="p-8 text-center">
                <p className="text-muted-foreground text-sm">Loading messages...</p>
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground text-sm">No messages found</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredMessages.map((message) => {
                  const msgType = getMessageType(message);
                  return (
                    <div
                      key={message.id}
                      onClick={() => handleSelectMessage(message)}
                      className={`p-4 cursor-pointer transition-colors hover:bg-muted/50 ${
                        selectedMessage?.id === message.id ? "bg-muted/30" : ""
                      } ${!message.read_at ? "bg-primary/5" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                            msgType === "broadcast"
                              ? "bg-secondary text-secondary-foreground"
                              : "bg-primary text-primary-foreground"
                          }`}
                        >
                          {msgType === "broadcast" ? <Users className="w-5 h-5" /> : <User className="w-5 h-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <p className="font-medium text-card-foreground text-sm truncate">{message.sender_name}</p>
                            {!message.read_at && <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></span>}
                          </div>
                          <p className="text-sm text-card-foreground font-medium truncate mb-1">{message.subject}</p>
                          <p className="text-xs text-muted-foreground truncate">{message.body}</p>
                          <p className="text-xs text-muted-foreground mt-2">{getRelativeTime(message.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Message Detail */}
        <div className="md:col-span-2 bg-card rounded-xl border border-border overflow-hidden">
          {selectedMessage ? (
            <div className="flex flex-col h-full">
              <div className="p-6 border-b border-border">
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center font-medium ${
                      getMessageType(selectedMessage) === "broadcast"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {getMessageType(selectedMessage) === "broadcast" ? <Users className="w-6 h-6" /> : <User className="w-6 h-6" />}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-card-foreground text-lg">{selectedMessage.subject}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      From: <span className="font-medium">{selectedMessage.sender_name}</span>
                    </p>
                    {selectedMessage.recipient_name && (
                      <p className="text-sm text-muted-foreground">To: {selectedMessage.recipient_name}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(selectedMessage.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        getMessageType(selectedMessage) === "broadcast"
                          ? "bg-secondary/20 text-secondary-foreground"
                          : "bg-primary/20 text-primary"
                      }`}
                    >
                      {getMessageType(selectedMessage)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-6 overflow-y-auto">
                <div className="prose max-w-none">
                  <p className="text-card-foreground whitespace-pre-wrap">{selectedMessage.body}</p>
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
                            {reply.sender_name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-sm text-card-foreground">{reply.sender_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(reply.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <p className="text-sm text-card-foreground ml-11">{reply.body}</p>
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
                  {user?.role === "member" && getMessageType(selectedMessage) === "broadcast" && (
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
