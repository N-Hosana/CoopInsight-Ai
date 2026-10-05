import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { api } from "../services/api";
import { useAuth } from "./AuthContext";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NOTIFICATION BELL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This used to be four hardcoded objects — a loan payment due, a "Jean Uwimana"
 * who did not exist, a meeting in May. It never called the API, which meant
 * every notification the backend actually writes was invisible: a member asking
 * to be removed, an assembly being convened, a settlement recorded, an issue
 * report escalating, a dissolution reaching the RCA. All of it was being stored
 * and none of it was being shown.
 *
 * It now reads `/notifications`, which is where all of those land, and polls so
 * a manager sitting on the page sees a request arrive without reloading.
 *
 * Anything that arrives after the first load is also queued as a real-time
 * alert (`toasts`), shown on whatever page the user is on — and, when the
 * browser tab is in the background and the user has allowed it, as a system
 * notification. The only "real-time alert" before this was a hardcoded fake on
 * the Notifications page itself.
 */

export interface Notification {
  id: string;
  type: "info" | "warning" | "success" | "alert";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  from?: string;
  action?: {
    label: string;
    link: string;
  };
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  addNotification: (notification: Omit<Notification, "id" | "timestamp" | "read">) => void;
  /** Re-reads from the server. Call it after an action that creates one. */
  refresh: () => Promise<void>;
  loading: boolean;
  /** Notifications that arrived while the app was open, not yet dismissed. */
  toasts: Notification[];
  dismissToast: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

/** How often to look for new ones while the app is open. */
const POLL_MS = 15_000;
/** At most this many alerts on screen at once; older ones drop off. */
const MAX_TOASTS = 3;

/**
 * The backend stores a free-form `type`; the bell renders four tones. Anything
 * unrecognised falls back to `info` rather than losing the notification.
 */
const TONES: Record<string, Notification["type"]> = {
  alert: "alert",
  warning: "warning",
  reminder: "warning",
  success: "success",
  info: "info",
  message: "info",
  announcement: "info",
};

/** Turns the link the backend stored into the button the bell shows. */
function actionFor(link: string | null): Notification["action"] | undefined {
  if (!link) return undefined;
  const labels: Array<[string, string]> = [
    ["/rca-services", "Open services & requests"],
    ["/membership", "Open the request"],
    ["/cooperative-requests", "Open the request"],
    ["/activities", "View the activity"],
    ["/messages", "Read the message"],
    ["/permits", "View the permit"],
    ["/monthly-audit", "Open the audit"],
    ["/funding", "View the application"],
  ];
  const match = labels.find(([prefix]) => link.startsWith(prefix));
  return { label: match?.[1] ?? "Open", link };
}

function mapNotification(row: any): Notification {
  return {
    id: String(row.id),
    type: TONES[String(row.type ?? "").toLowerCase()] ?? "info",
    title: row.title ?? "Notification",
    message: row.message ?? "",
    timestamp: row.created_at ?? new Date().toISOString(),
    read: Boolean(row.read_at),
    action: actionFor(row.link ?? null),
  };
}

/** Where a notification itself is opened: the inbox, scrolled to it. */
export const notificationPath = (id: string) => `/notifications?open=${encodeURIComponent(id)}`;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Notifications created optimistically in the browser (addNotification) have
  // no row on the server, so a refresh would wipe them. They are held apart and
  // merged on top of whatever the server returns.
  const localRef = useRef<Notification[]>([]);

  // Real-time alerts. The first load only records what already exists — a
  // user logging in should not be greeted by thirty alerts for old news.
  const [toasts, setToasts] = useState<Notification[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  const announce = useCallback((fresh: Notification[]) => {
    if (!fresh.length) return;
    setToasts((prev) => [...fresh, ...prev].slice(0, MAX_TOASTS));
    // In a background tab the in-app alert is invisible; use the system one.
    if (typeof document !== "undefined" && document.hidden && "Notification" in window
        && window.Notification.permission === "granted") {
      for (const n of fresh) {
        const sys = new window.Notification(n.title, { body: n.message, tag: n.id });
        sys.onclick = () => {
          window.focus();
          window.location.assign(notificationPath(n.id));
        };
      }
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      const res = await api.get<{ data: any[]; unreadCount: number }>("/notifications?limit=30");
      const fromServer = (res.data ?? []).map(mapNotification);
      const fresh = fromServer.filter((n) => !n.read && !seenRef.current.has(n.id));
      fromServer.forEach((n) => seenRef.current.add(n.id));
      if (primedRef.current) announce(fresh);
      primedRef.current = true;
      setNotifications([...localRef.current, ...fromServer]);
      setUnreadCount(
        (res.unreadCount ?? 0) + localRef.current.filter((n) => !n.read).length
      );
    } catch {
      // A failed poll is not worth surfacing — the bell simply keeps showing
      // what it last knew. Throwing here would put an error banner on every
      // page in the app every 45 seconds if the backend restarts.
    }
  }, [isAuthenticated, announce]);

  useEffect(() => {
    if (!isAuthenticated) {
      seenRef.current = new Set();
      primedRef.current = false;
      setToasts([]);
      localRef.current = [];
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    let cancelled = false;
    setLoading(true);
    refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });

    const timer = setInterval(refresh, POLL_MS);

    // Coming back to the tab is the moment someone most wants this current.
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [isAuthenticated, refresh]);

  const markAsRead = (id: string) => {
    dismissToast(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    localRef.current = localRef.current.map((n) => (n.id === id ? { ...n, read: true } : n));
    // Local-only notifications have no server row to update.
    if (!localRef.current.some((n) => n.id === id)) {
      api.patch(`/notifications/${id}/read`, {}).catch(() => refresh());
    }
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    localRef.current = localRef.current.map((n) => ({ ...n, read: true }));
    api.patch("/notifications/read-all", {}).catch(() => refresh());
  };

  const addNotification = (notification: Omit<Notification, "id" | "timestamp" | "read">) => {
    const created: Notification = {
      ...notification,
      id: `local-${Date.now()}`,
      timestamp: new Date().toISOString(),
      read: false,
    };
    localRef.current = [created, ...localRef.current];
    seenRef.current.add(created.id);
    setNotifications((prev) => [created, ...prev]);
    setUnreadCount((c) => c + 1);
    announce([created]);
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        addNotification,
        refresh,
        loading,
        toasts,
        dismissToast,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
}
