import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Cooperatives } from "./pages/Cooperatives";
import { CooperativeProfile } from "./pages/CooperativeProfile";
import { Members } from "./pages/Members";
import { MemberDetails } from "./pages/MemberDetails";
import { Activities } from "./pages/Activities";
import { ActivityDetails } from "./pages/ActivityDetails";
import { RecordTransaction } from "./pages/RecordTransaction";
import { AIInsights } from "./pages/AIInsights";
import { GovernmentMonitoring } from "./pages/GovernmentMonitoring";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      {
        index: true,
        element: <Dashboard />,
      },
      {
        path: "cooperatives",
        element: <Cooperatives />,
      },
      {
        path: "cooperatives/profile",
        element: <CooperativeProfile />,
      },
      {
        path: "members",
        element: <Members />,
      },
      {
        path: "members/:id",
        element: <MemberDetails />,
      },
      {
        path: "activities",
        element: <Activities />,
      },
      {
        path: "activities/:id",
        element: <ActivityDetails />,
      },
      {
        path: "record-transaction",
        element: <RecordTransaction />,
      },
      {
        path: "ai-insights",
        element: <AIInsights />,
      },
      {
        path: "government-monitoring",
        element: <GovernmentMonitoring />,
      },
      {
        path: "reports",
        element: <Reports />,
      },
      {
        path: "settings",
        element: <Settings />,
      },
    ],
  },
]);
