import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import AuthGate from "./components/auth-gate.tsx";
import AppLayout from "./components/app-layout.tsx";

const DashboardPage = lazy(() => import("./pages/dashboard/page.tsx"));
const TeamPage = lazy(() => import("./pages/team/page.tsx"));
const SettingsPage = lazy(() => import("./pages/settings/page.tsx"));
const CompaniesPage = lazy(() => import("./pages/companies/page.tsx"));
const CompanyDetailPage = lazy(
  () => import("./pages/companies/detail-page.tsx"),
);
const PipelinePage = lazy(() => import("./pages/pipeline/page.tsx"));
const OpportunityDetailPage = lazy(
  () => import("./pages/pipeline/detail-page.tsx"),
);
const TargetsPage = lazy(() => import("./pages/targets/page.tsx"));
const ActivitiesPage = lazy(() => import("./pages/activities/page.tsx"));
const PerformancePage = lazy(() => import("./pages/performance/page.tsx"));
const UsagePage = lazy(() => import("./pages/usage/page.tsx"));
const UsageAutoFillPage = lazy(
  () => import("./pages/usage/auto-fill-page.tsx"),
);
const AtRiskPage = lazy(() => import("./pages/at-risk/page.tsx"));
const QuotesPage = lazy(() => import("./pages/quotes/page.tsx"));
const NewOpportunityQuotePage = lazy(
  () => import("./pages/quotes/new-page.tsx"),
);
const QuoteGenerateFromUsagePage = lazy(
  () => import("./pages/quotes/generate-page.tsx"),
);
const CombinedQuotePage = lazy(
  () => import("./pages/quotes/combined-page.tsx"),
);
const CombinedQuoteDetailPage = lazy(
  () => import("./pages/quotes/combined-detail-page.tsx"),
);
const QuoteFromAdvisorPage = lazy(
  () => import("./pages/quotes/from-advisor-page.tsx"),
);
const QuoteDetailPage = lazy(() => import("./pages/quotes/detail-page.tsx"));
const InvoicesPage = lazy(() => import("./pages/invoices/page.tsx"));
const InvoiceDetailPage = lazy(
  () => import("./pages/invoices/detail-page.tsx"),
);
const InvoicePrintPage = lazy(() => import("./pages/invoices/print-page.tsx"));
const ExpensesPage = lazy(() => import("./pages/finance/expenses/page.tsx"));
const ExpenseDetailPage = lazy(
  () => import("./pages/finance/expenses/detail-page.tsx"),
);
const ExpenseCategoriesPage = lazy(
  () => import("./pages/finance/expense-categories/page.tsx"),
);
const FinanceSettingsPage = lazy(
  () => import("./pages/finance/settings/page.tsx"),
);
const FinanceReportsPage = lazy(
  () => import("./pages/finance/reports/page.tsx"),
);
const CollectionsPage = lazy(
  () => import("./pages/finance/collections/page.tsx"),
);
const InvoiceProfilesPage = lazy(
  () => import("./pages/finance/invoice-profiles/page.tsx"),
);
const DailyUsagePage = lazy(
  () => import("./pages/finance/daily-usage/page.tsx"),
);
const CustomerContractsPage = lazy(
  () => import("./pages/finance/customer-contracts/page.tsx"),
);
const ContractRenewalsPage = lazy(
  () => import("./pages/finance/customer-contracts/renewals-page.tsx"),
);
const ContractPerformancePage = lazy(
  () => import("./pages/finance/customer-contracts/performance-page.tsx"),
);
const CustomerContractDetailPage = lazy(
  () => import("./pages/finance/customer-contracts/detail-page.tsx"),
);
const NewCustomerContractPage = lazy(
  () => import("./pages/finance/customer-contracts/new-page.tsx"),
);
const RecommendationsPage = lazy(
  () => import("./pages/recommendations/page.tsx"),
);
const CoachPage = lazy(() => import("./pages/coach/page.tsx"));
const ManageOneTenantsPage = lazy(
  () => import("./pages/manageone-tenants/page.tsx"),
);
const ManageOneHourlyPage = lazy(
  () => import("./pages/manageone-hourly/page.tsx"),
);
const CloudHealthPage = lazy(() => import("./pages/cloud-health/page.tsx"));
const CloudHealthAlarmPage = lazy(
  () => import("./pages/cloud-health/alarm-page.tsx"),
);
const CloudHealthHostGroupPage = lazy(
  () => import("./pages/cloud-health/host-group-page.tsx"),
);
const CloudHealthRegionPage = lazy(
  () => import("./pages/cloud-health/region-page.tsx"),
);
const DocumentationPage = lazy(() => import("./pages/documentation/page.tsx"));
const TasksPage = lazy(() => import("./pages/tasks/page.tsx"));
const TaskDetailPage = lazy(() => import("./pages/tasks/detail-page.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

function PageLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
      Loading page...
    </div>
  );
}

function lazyPage(page: ReactNode) {
  return <Suspense fallback={<PageLoading />}>{page}</Suspense>;
}

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
            <Route path="/dashboard" element={lazyPage(<DashboardPage />)} />
            <Route path="/companies" element={lazyPage(<CompaniesPage />)} />
            <Route
              path="/companies/:id"
              element={lazyPage(<CompanyDetailPage />)}
            />
            <Route path="/pipeline" element={lazyPage(<PipelinePage />)} />
            <Route
              path="/pipeline/:id"
              element={lazyPage(<OpportunityDetailPage />)}
            />
            <Route path="/targets" element={lazyPage(<TargetsPage />)} />
            <Route
              path="/performance"
              element={lazyPage(<PerformancePage />)}
            />
            <Route path="/usage" element={lazyPage(<UsagePage />)} />
            <Route
              path="/usage/auto-fill"
              element={lazyPage(<UsageAutoFillPage />)}
            />
            <Route path="/at-risk" element={lazyPage(<AtRiskPage />)} />
            <Route path="/quotes" element={lazyPage(<QuotesPage />)} />
            <Route
              path="/quotes/new"
              element={lazyPage(<NewOpportunityQuotePage />)}
            />
            <Route path="/invoices" element={lazyPage(<InvoicesPage />)} />
            <Route
              path="/invoices/:invoiceId/print"
              element={lazyPage(<InvoicePrintPage />)}
            />
            <Route
              path="/invoices/:invoiceId"
              element={lazyPage(<InvoiceDetailPage />)}
            />
            <Route
              path="/finance/expenses"
              element={lazyPage(<ExpensesPage />)}
            />
            <Route
              path="/finance/expense-categories"
              element={lazyPage(<ExpenseCategoriesPage />)}
            />
            <Route
              path="/finance/reports"
              element={lazyPage(<FinanceReportsPage />)}
            />
            <Route
              path="/finance/reports/revenue"
              element={lazyPage(<FinanceReportsPage view="revenue" />)}
            />
            <Route
              path="/finance/reports/expenses"
              element={lazyPage(<FinanceReportsPage view="expenses" />)}
            />
            <Route
              path="/finance/reports/country"
              element={lazyPage(<FinanceReportsPage view="country" />)}
            />
            <Route
              path="/finance/collections"
              element={lazyPage(<CollectionsPage />)}
            />
            <Route
              path="/finance/accounts"
              element={lazyPage(<CollectionsPage accountsMode />)}
            />
            <Route
              path="/finance/invoice-profiles"
              element={lazyPage(<InvoiceProfilesPage />)}
            />
            <Route
              path="/finance/daily-usage"
              element={lazyPage(<DailyUsagePage />)}
            />
            <Route
              path="/finance/customer-contracts"
              element={lazyPage(<CustomerContractsPage />)}
            />
            <Route
              path="/finance/contract-renewals"
              element={lazyPage(<ContractRenewalsPage />)}
            />
            <Route
              path="/finance/contract-performance"
              element={lazyPage(<ContractPerformancePage />)}
            />
            <Route
              path="/finance/customer-contracts/:contractId"
              element={lazyPage(<CustomerContractDetailPage />)}
            />
            <Route
              path="/finance/customer-contracts/new"
              element={lazyPage(<NewCustomerContractPage />)}
            />
            <Route
              path="/finance/customer-contracts/:contractId/edit"
              element={lazyPage(<NewCustomerContractPage />)}
            />
            <Route
              path="/finance/settings"
              element={lazyPage(<FinanceSettingsPage />)}
            />
            <Route
              path="/finance/expenses/:expenseId"
              element={lazyPage(<ExpenseDetailPage />)}
            />
            <Route
              path="/quotes/generate"
              element={lazyPage(<QuoteGenerateFromUsagePage />)}
            />
            <Route
              path="/quotes/combined"
              element={lazyPage(<CombinedQuotePage />)}
            />
            <Route
              path="/quotes/combined/:id"
              element={lazyPage(<CombinedQuoteDetailPage />)}
            />
            <Route
              path="/quotes/from-advisor"
              element={lazyPage(<QuoteFromAdvisorPage />)}
            />
            <Route path="/quotes/:id" element={lazyPage(<QuoteDetailPage />)} />
            <Route
              path="/recommendations"
              element={lazyPage(<RecommendationsPage />)}
            />
            <Route path="/coach" element={lazyPage(<CoachPage />)} />
            <Route path="/activities" element={lazyPage(<ActivitiesPage />)} />
            <Route
              path="/manageone-tenants"
              element={lazyPage(<ManageOneTenantsPage />)}
            />
            <Route
              path="/manageone-hourly"
              element={lazyPage(<ManageOneHourlyPage />)}
            />
            <Route
              path="/cloud-health"
              element={lazyPage(<CloudHealthPage />)}
            />
            <Route
              path="/cloud-health/alarms/:csn"
              element={lazyPage(<CloudHealthAlarmPage />)}
            />
            <Route
              path="/cloud-health/host-groups/:hostGroupId"
              element={lazyPage(<CloudHealthHostGroupPage />)}
            />
            <Route
              path="/cloud-health/regions/:regionId"
              element={lazyPage(<CloudHealthRegionPage />)}
            />
            <Route
              path="/documentation"
              element={lazyPage(<DocumentationPage />)}
            />
            <Route
              path="/documentation/:slug"
              element={lazyPage(<DocumentationPage />)}
            />
            <Route path="/tasks" element={lazyPage(<TasksPage />)} />
            <Route
              path="/tasks/:taskId"
              element={lazyPage(<TaskDetailPage />)}
            />
            <Route path="/team" element={lazyPage(<TeamPage />)} />
            <Route path="/settings" element={lazyPage(<SettingsPage />)} />
          </Route>
          <Route path="*" element={lazyPage(<NotFound />)} />
        </Routes>
      </BrowserRouter>
    </DefaultProviders>
  );
}
