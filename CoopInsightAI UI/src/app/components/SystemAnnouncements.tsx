import { useState } from "react";
import { AlertCircle, CheckCircle, Info, X } from "lucide-react";

export interface SystemAnnouncement {
  id: string;
  type: "info" | "warning" | "success" | "alert";
  title: string;
  message: string;
  icon?: React.ReactNode;
  dismissible?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface SystemAnnouncementsProps {
  announcements: SystemAnnouncement[];
  onDismiss?: (id: string) => void;
}

export function SystemAnnouncements({ announcements, onDismiss }: SystemAnnouncementsProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const handleDismiss = (id: string) => {
    const newDismissed = new Set(dismissed);
    newDismissed.add(id);
    setDismissed(newDismissed);
    onDismiss?.(id);
  };

  const visibleAnnouncements = announcements.filter(a => !dismissed.has(a.id));

  if (visibleAnnouncements.length === 0) {
    return null;
  }

  const getIcon = (type: SystemAnnouncement["type"]) => {
    switch (type) {
      case "warning":
        return <AlertCircle className="w-5 h-5 text-amber-600" />;
      case "success":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "alert":
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      case "info":
      default:
        return <Info className="w-5 h-5 text-blue-600" />;
    }
  };

  const getBgColor = (type: SystemAnnouncement["type"]) => {
    switch (type) {
      case "warning":
        return "bg-amber-50 border-amber-200";
      case "success":
        return "bg-green-50 border-green-200";
      case "alert":
        return "bg-red-50 border-red-200";
      case "info":
      default:
        return "bg-blue-50 border-blue-200";
    }
  };

  const getTextColor = (type: SystemAnnouncement["type"]) => {
    switch (type) {
      case "warning":
        return "text-amber-900";
      case "success":
        return "text-green-900";
      case "alert":
        return "text-red-900";
      case "info":
      default:
        return "text-blue-900";
    }
  };

  return (
    <div className="space-y-3">
      {visibleAnnouncements.map((announcement) => (
        <div
          key={announcement.id}
          className={`border rounded-lg p-4 flex items-start gap-4 ${getBgColor(announcement.type)}`}
        >
          <div className="flex-shrink-0 pt-0.5">
            {announcement.icon || getIcon(announcement.type)}
          </div>
          <div className="flex-1">
            <h3 className={`font-semibold ${getTextColor(announcement.type)} mb-1`}>
              {announcement.title}
            </h3>
            <p className={`text-sm ${getTextColor(announcement.type)} opacity-90`}>
              {announcement.message}
            </p>
            {announcement.action && (
              <button
                onClick={announcement.action.onClick}
                className={`mt-2 text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
                  announcement.type === "warning"
                    ? "bg-amber-100 hover:bg-amber-200 text-amber-700"
                    : announcement.type === "success"
                    ? "bg-green-100 hover:bg-green-200 text-green-700"
                    : announcement.type === "alert"
                    ? "bg-red-100 hover:bg-red-200 text-red-700"
                    : "bg-blue-100 hover:bg-blue-200 text-blue-700"
                }`}
              >
                {announcement.action.label}
              </button>
            )}
          </div>
          {announcement.dismissible !== false && (
            <button
              onClick={() => handleDismiss(announcement.id)}
              className={`flex-shrink-0 p-1 rounded-md transition-colors ${
                announcement.type === "warning"
                  ? "hover:bg-amber-200"
                  : announcement.type === "success"
                  ? "hover:bg-green-200"
                  : announcement.type === "alert"
                  ? "hover:bg-red-200"
                  : "hover:bg-blue-200"
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
