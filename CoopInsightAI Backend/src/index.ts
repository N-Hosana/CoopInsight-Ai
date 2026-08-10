import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/auth";
import cooperativeRoutes from "./routes/cooperatives";
import memberRoutes from "./routes/members";
import transactionRoutes from "./routes/transactions";
import activityRoutes from "./routes/activities";
import dashboardRoutes from "./routes/dashboard";
import reportRoutes from "./routes/reports";
import messageRoutes from "./routes/messages";
import notificationRoutes from "./routes/notifications";
import securityRoutes from "./routes/security";
import settingsRoutes from "./routes/settings";
import integrationRoutes from "./routes/integrations";
import aiRoutes from "./routes/ai";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

// ── Health check ─────────────────────────────
app.get("/", (_req, res) => {
  res.json({ message: "CoopInsightAI backend is running", version: "2.0.0" });
});

// ── Auth ──────────────────────────────────────
app.use("/api/auth", authRoutes);

// ── Core data ────────────────────────────────
app.use("/api/cooperatives", cooperativeRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/activities", activityRoutes);

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
