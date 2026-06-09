import { useState } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import { MessageSquare, Send, CheckCircle2 } from "lucide-react";

interface Member {
  id: string;
  name: string;
  phone: string;
  cooperative: string;
}

interface SMSPanelProps {
  members: Member[];
}

export function SMSPanel({ members }: SMSPanelProps) {
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [sentMessages, setSentMessages] = useState<Array<{ member: string; time: string }>>([]);
  const [showSuccess, setShowSuccess] = useState(false);

  const toggleMember = (memberId: string) => {
    setSelectedMembers(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const selectAll = () => {
    if (selectedMembers.length === members.length) {
      setSelectedMembers([]);
    } else {
      setSelectedMembers(members.map(m => m.id));
    }
  };

  const handleSend = () => {
    if (!message.trim() || selectedMembers.length === 0) return;

    const newSentMessages = selectedMembers.map(id => {
      const member = members.find(m => m.id === id);
      return {
        member: member?.name || "",
        time: new Date().toLocaleTimeString(),
      };
    });

    // Save to localStorage for offline capability
    const existingSMS = JSON.parse(localStorage.getItem('coopinsight_sms') || '[]');
    localStorage.setItem('coopinsight_sms', JSON.stringify([...existingSMS, ...newSentMessages]));

    setSentMessages([...newSentMessages, ...sentMessages]);
    setShowSuccess(true);
    setMessage("");
    setSelectedMembers([]);

    setTimeout(() => setShowSuccess(false), 3000);
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-[#2D6A4F]/10 flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-[#2D6A4F]" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">SMS Notifications</h3>
          <p className="text-sm text-gray-500">Send updates and reminders to members</p>
        </div>
      </div>

      {showSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-800">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm">Message sent to {selectedMembers.length} member(s) successfully!</span>
        </div>
      )}

      {/* Member Selection */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Select Recipients</label>
          <button
            type="button"
            onClick={selectAll}
            className="text-sm text-[#2D6A4F] hover:underline"
          >
            {selectedMembers.length === members.length ? 'Deselect All' : 'Select All'}
          </button>
        </div>
        <div className="border border-gray-300 rounded-lg max-h-48 overflow-y-auto">
          {members.map(member => (
            <label
              key={member.id}
              className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
            >
              <input
                type="checkbox"
                checked={selectedMembers.includes(member.id)}
                onChange={() => toggleMember(member.id)}
                className="w-4 h-4 text-[#2D6A4F] rounded focus:ring-[#2D6A4F]"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{member.name}</p>
                <p className="text-xs text-gray-500">{member.cooperative}</p>
              </div>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {selectedMembers.length} of {members.length} members selected
        </p>
      </div>

      {/* Message Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
          rows={4}
          placeholder="Enter your message here... (e.g., 'Meeting tomorrow at 10 AM. Please bring your monthly reports.')"
        />
        <p className="text-xs text-gray-500 mt-1">{message.length} characters</p>
      </div>

      <Button
        onClick={handleSend}
        disabled={!message.trim() || selectedMembers.length === 0}
        className="w-full"
      >
        <Send className="w-4 h-4 mr-2" />
        Send SMS to {selectedMembers.length} Member{selectedMembers.length !== 1 ? 's' : ''}
      </Button>

      {/* Recent Messages */}
      {sentMessages.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Recent Messages</h4>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {sentMessages.slice(0, 5).map((msg, index) => (
              <div key={index} className="text-xs text-gray-600 flex items-center gap-2">
                <CheckCircle2 className="w-3 h-3 text-green-600" />
                <span>Sent to {msg.member} at {msg.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
