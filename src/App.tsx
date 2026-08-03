import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import AuthGate from "./components/auth-gate.tsx";
import AppLayout from "./components/app-layout.tsx";
import DashboardPage from "./pages/dashboard/page.tsx";
import TeamPage from "./pages/team/page.tsx";
import SettingsPage from "./pages/settings/page.tsx";
import CompaniesPage from "./pages/companies/page.tsx";
import CompanyDetailPage from "./pages/companies/detail-page.tsx";
import PipelinePage from "./pages/pipeline/page.tsx";
import TargetsPage from "./pages/targets/page.tsx";
import ActivitiesPage from "./pages/activities/page.tsx";
import PerformancePage from "./pages/performance/page.tsx";
import UsagePage from "./pages/usage/page.tsx";
import UsageAutoFillPage from "./pages/usage/auto-fill-page.tsx";
import AtRiskPage from "./pages/at-risk/page.tsx";
import QuotesPage from "./pages/quotes/page.tsx";
import QuoteGenerateFromUsagePage from "./pages/quotes/generate-page.tsx";
import QuoteFromAdvisorPage from "./pages/quotes/from-advisor-page.tsx";
import QuoteDetailPage from "./pages/quotes/detail-page.tsx";
import InvoicesPage from "./pages/invoices/page.tsx";
import RecommendationsPage from "./pages/recommendations/page.tsx";
import CoachPage from "./pages/coach/page.tsx";
import ManageOneTenantsPage from "./pages/manageone-tenants/page.tsx";
import CloudHealthPage from "./pages/cloud-health/page.tsx";
import CloudHealthAlarmPage from "./pages/cloud-health/alarm-page.tsx";
import CloudHealthHostGroupPage from "./pages/cloud-health/host-group-page.tsx";
import CloudHealthRegionPage from "./pages/cloud-health/region-page.tsx";
import DocumentationPage from "./pages/documentation/page.tsx";
import TasksPage from "./pages/tasks/page.tsx";
import TaskDetailPage from "./pages/tasks/detail-page.tsx";
import NotFound from "./pages/NotFound.tsx";

export default function App() {
  return (
    <DefaultProviders>
      <BrowserRouter>
        <Routes>
          <Route
            element={
              <AuthGate>
                <AppLayout />
              </AuthGate>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:id" element={<CompanyDetailPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/targets" element={<TargetsPage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/usage/auto-fill" element={<UsageAutoFillPage />} />
            <Route path="/at-risk" element={<AtRiskPage />} />
            <Route path="/quotes" element={<QuotesPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route
              path="/quotes/generate"
              element={<QuoteGenerateFromUsagePage />}
            />
            <Route
              path="/quotes/from-advisor"
              element={<QuoteFromAdvisorPage />}
            />
            <Route path="/quotes/:id" element={<QuoteDetailPage />} />
            <Route path="/recommendations" element={<RecommendationsPage />} />
            <Route path="/coach" element={<CoachPage />} />
            <Route path="/activities" element={<ActivitiesPage />} />
            <Route
              path="/manageone-tenants"
              element={<ManageOneTenantsPage />}
            />
            <Route path="/cloud-health" element={<CloudHealthPage />} />
            <Route
              path="/cloud-health/alarms/:csn"
              element={<CloudHealthAlarmPage />}
            />
            <Route
              path="/cloud-health/host-groups/:hostGroupId"
              element={<CloudHealthHostGroupPage />}
            />
            <Route
              path="/cloud-health/regions/:regionId"
              element={<CloudHealthRegionPage />}
            />
            <Route path="/documentation" element={<DocumentationPage />} />
            <Route path="/documentation/:slug" element={<DocumentationPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </DefaultProviders>
  );
}
