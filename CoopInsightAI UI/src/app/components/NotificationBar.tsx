import { useState } from "react";
import { Bell, X, CheckCheck, ExternalLink, Eye } from "lucide-react";
import { useNotifications } from "../contexts/NotificationContext";
import { Link, useNavigate } from "react-router";

export function NotificationBar() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<any>(null);
  const navigate = useNavigate();

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "warning":
        return "⚠️";
      case "success":
        return "✅";
      case "alert":
        return "🚨";
      default:
        return "ℹ️";
    }
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
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 hover:bg-muted rounded-lg transition-colors"
      >
        <Bell className="w-5 h-5 text-foreground" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 w-5 h-5 bg-destructive text-destructive-foreground text-xs font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          ></div>
          <div className="absolute right-0 top-12 w-96 max-h-[500px] bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-foreground" />
                <h3 className="font-semibold text-card-foreground">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 bg-primary text-primary-foreground text-xs font-medium rounded-full">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <CheckCheck className="w-4 h-4" />
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-muted-foreground">No notifications</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 hover:bg-muted/50 transition-colors cursor-pointer ${
                        !notification.read ? "bg-primary/5" : ""
                      }`}
                      onClick={() => markAsRead(notification.id)}
                    >
                      <div className="flex gap-3">
                        <div className="text-2xl flex-shrink-0">{getNotificationIcon(notification.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className="font-medium text-card-foreground text-sm">{notification.title}</h4>
                            {!notification.read && (
                              <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1"></span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{notification.message}</p>
                          <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                            <span>{getRelativeTime(notification.timestamp)}</span>
                            {notification.from && <span>From: {notification.from}</span>}
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedNotification(notification);
                              }}
                              className="text-xs text-primary hover:underline flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                              View Details
                            </button>
                            {!notification.read && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markAsRead(notification.id);
                                }}
                                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                              >
                                <CheckCheck className="w-3 h-3" />
                                Mark as Read
                              </button>
                            )}
                            {notification.action && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(notification.action!.link);
                                  setIsOpen(false);
                                }}
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                              >
                                {notification.action.label}
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 border-t border-border bg-muted/30">
              <Link
                to="/notifications"
                className="block text-center text-sm text-primary hover:underline font-medium"
                onClick={() => setIsOpen(false)}
              >
                View All Notifications
              </Link>
            </div>
          </div>
        </>
      )}

      {/* Notification Detail Modal */}
      {selectedNotification && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-lg">
            <div className="p-6 border-b border-border flex items-center justify-between">
              <h2 className="text-xl font-semibold text-card-foreground">Notification Details</h2>
              <button onClick={() => setSelectedNotification(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="text-3xl">{getNotificationIcon(selectedNotification.type)}</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-card-foreground text-lg mb-1">{selectedNotification.title}</h3>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                    <span>{new Date(selectedNotification.timestamp).toLocaleString()}</span>
                    {selectedNotification.from && <span>From: {selectedNotification.from}</span>}
                  </div>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    selectedNotification.type === "warning"
                      ? "bg-yellow-100 text-yellow-800"
                      : selectedNotification.type === "success"
                      ? "bg-green-100 text-green-800"
                      : selectedNotification.type === "alert"
                      ? "bg-red-100 text-red-800"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {selectedNotification.type}
                </span>
              </div>

              <div className="bg-muted p-4 rounded-lg mb-4">
                <p className="text-card-foreground whitespace-pre-wrap">{selectedNotification.message}</p>
              </div>

              <div className="flex gap-3 justify-end">
                {!selectedNotification.read && (
                  <button
                    onClick={() => {
                      markAsRead(selectedNotification.id);
                      setSelectedNotification(null);
                    }}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
                  >
                    Mark as Read & Close
                  </button>
                )}
                {selectedNotification.action && (
                  <button
                    onClick={() => {
                      navigate(selectedNotification.action!.link);
                      setSelectedNotification(null);
                      setIsOpen(false);
                    }}
                    className="px-4 py-2 border border-border rounded-lg text-card-foreground hover:bg-muted transition-colors"
                  >
                    {selectedNotification.action.label}
                  </button>
                )}
                <button
                  onClick={() => setSelectedNotification(null)}
                  className="px-4 py-2 border border-border rounded-lg text-card-foreground hover:bg-muted transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
