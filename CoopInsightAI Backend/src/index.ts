import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

import authRoutes from "./routes/auth";
import cooperativeRoutes from "./routes/cooperatives";
import memberRoutes from "./routes/members";
import membershipRoutes from "./routes/membership";
import cooperativeRequestRoutes from "./routes/cooperativeRequests";
import transactionRoutes from "./routes/transactions";
import activityRoutes from "./routes/activities";
import dashboardRoutes from "./routes/dashboard";
import reportRoutes from "./routes/reports";
import messageRoutes from "./routes/messages";
import notificationRoutes from "./routes/notifications";
import securityRoutes from "./routes/security";
import settingsRoutes from "./routes/settings";
import integrationRoutes from "./routes/integrations";
import permitRoutes from "./routes/permits";
import auditRoutes from "./routes/audits";
import fundingRoutes from "./routes/funding";
import aiRoutes from "./routes/ai";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// In production, lock CORS to the configured CLIENT_URL. In dev, allow any localhost
// port — Vite auto-increments to 5174+ when 5173 is already taken, and hardcoding one
// port breaks the app every time that happens.
const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? process.env.CLIENT_URL
        : (origin, callback) => {
            if (!origin || localhostPattern.test(origin)) {
              callback(null, true);
            } else {
              callback(new Error("Not allowed by CORS"));
            }
          },
  })
);
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// ── Health check ─────────────────────────────
app.get("/", (_req, res) => {
  res.json({ message: "CoopInsightAI backend is running", version: "2.0.0" });
});

// ── Auth ──────────────────────────────────────
app.use("/api/auth", authRoutes);

// ── Core data ────────────────────────────────
app.use("/api/cooperatives", cooperativeRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/membership", membershipRoutes);
app.use("/api/cooperative-requests", cooperativeRequestRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/activities", activityRoutes);

// ── Licensing, audits & external support ─────
app.use("/api/permits", permitRoutes);
app.use("/api/audits", auditRoutes);
app.use("/api/funding", fundingRoutes);

// ── Dashboard & Monitoring ───────────────────
app.use("/api/dashboard", dashboardRoutes);

// ── Reports & Budget ─────────────────────────
app.use("/api/reports", reportRoutes);

// ── Communication ────────────────────────────
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);

// ── Admin / Platform ─────────────────────────
app.use("/api/security", securityRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/integrations", integrationRoutes);

// ── AI Service proxy ─────────────────────────
app.use("/api/ai", aiRoutes);

// ── 404 handler ──────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.listen(port, () => {
  console.log(`CoopInsightAI backend running on http://localhost:${port}`);
});
