import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { RequirePermission } from '@/components/Can';
import { Dashboard } from '@/pages/Dashboard';
import { Login } from '@/pages/auth/Login';
import { Register } from '@/pages/auth/Register';
import { ForgotPassword } from '@/pages/auth/ForgotPassword';
import { ResetPassword } from '@/pages/auth/ResetPassword';
import { AcceptInvite } from '@/pages/auth/AcceptInvite';
import { ProductsList } from '@/pages/products/ProductsList';
import { ProductForm } from '@/pages/products/ProductForm';
import { MastersPage } from '@/pages/products/MastersPage';
import { PosScreen } from '@/pages/pos/PosScreen';
import { TrialBalanceReport } from '@/pages/reports/TrialBalanceReport';
import { ProfitLossReport } from '@/pages/reports/ProfitLossReport';
import { BalanceSheetReport } from '@/pages/reports/BalanceSheetReport';
import { DayBookReport } from '@/pages/reports/DayBookReport';
import { ReportsHub } from '@/pages/reports/ReportsHub';
import { SalesReportPage } from '@/pages/reports/SalesReportPage';
import { PurchaseReportPage } from '@/pages/reports/PurchaseReportPage';
import { InventoryValuationPage } from '@/pages/reports/InventoryValuationPage';
import { StockMovementReportPage } from '@/pages/reports/StockMovementReportPage';
import { OutstandingAgingReportPage } from '@/pages/reports/OutstandingAgingReportPage';
import { ProductPerformanceReportPage } from '@/pages/reports/ProductPerformanceReportPage';
import { ChartOfAccounts } from '@/pages/accounting/ChartOfAccounts';
import { JournalEntries } from '@/pages/accounting/JournalEntries';
import { LedgerView } from '@/pages/accounting/LedgerView';
import { PurchaseList } from '@/pages/purchase/PurchaseList';
import { PurchaseDetail } from '@/pages/purchase/PurchaseDetail';
import { PurchaseForm } from '@/pages/purchase/PurchaseForm';
import { PurchaseReturnForm } from '@/pages/purchase/PurchaseReturnForm';
import { ReturnForm } from '@/pages/sales/ReturnForm';
import { SalesList } from '@/pages/sales/SalesList';
import { SalesDocumentDetail } from '@/pages/sales/SalesDocumentDetail';
import { InvoiceForm } from '@/pages/sales/InvoiceForm';
import { InventoryList } from '@/pages/inventory/InventoryList';
import { StockTransfer } from '@/pages/inventory/StockTransfer';
import { StockAdjustment } from '@/pages/inventory/StockAdjustment';
import { ProductHistory } from '@/pages/inventory/ProductHistory';
import { CustomersList } from '@/pages/customers/CustomersList';
import { CustomerProfile } from '@/pages/customers/CustomerProfile';
import { SuppliersList } from '@/pages/suppliers/SuppliersList';
import { SupplierProfile } from '@/pages/suppliers/SupplierProfile';
import { NoAccess } from '@/pages/NoAccess';
import { CompanyWizard } from '@/pages/company/CompanyWizard';
import { CompanySettings } from '@/pages/company/CompanySettings';
import { SettingsUsers } from '@/pages/settings/Users';
import { SettingsRoles } from '@/pages/settings/Roles';
import { SettingsActivityLog } from '@/pages/settings/ActivityLog';
import { HsnSummaryReport } from '@/pages/gst/HsnSummaryReport';
import { Gstr1Report } from '@/pages/gst/Gstr1Report';
import { Gstr3bReport } from '@/pages/gst/Gstr3bReport';
import { GstRates } from '@/pages/settings/GstRates';
import { ExpensesPage } from '@/pages/expenses/ExpensesPage';
import { ExpenseCategorySettings } from '@/pages/expenses/ExpenseCategorySettings';
import { BankAccountsPage } from '@/pages/banking/BankAccountsPage';
import { BankTransactionsPage } from '@/pages/banking/BankTransactionsPage';
import { ReconciliationPage } from '@/pages/banking/ReconciliationPage';
import { NotificationSettings } from '@/pages/settings/NotificationSettings';
import { NotificationHistory } from '@/pages/settings/NotificationHistory';
import { BillingPage } from '@/pages/settings/BillingPage';
import { AdminDashboard } from '@/pages/admin/AdminDashboard';
import { AiAssistantPage } from '@/pages/ai/AiAssistantPage';
import { ScanBillPage } from '@/pages/purchase/ScanBillPage';
import { TallySyncPage } from '@/pages/settings/TallySyncPage';
import { SalesmanTrackingPage } from '@/pages/admin/SalesmanTrackingPage';
import { HardwareSettingsPage } from '@/pages/settings/HardwareSettingsPage';
import { OnlineStorePage } from '@/pages/settings/OnlineStorePage';
import { CampaignsPage } from '@/pages/marketing/CampaignsPage';
import { SmartAdsPage } from '@/pages/marketing/SmartAdsPage';
import { StorefrontPage } from '@/pages/store/StorefrontPage';


const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/accept-invite', element: <AcceptInvite /> },
  // Public storefront — no auth required
  { path: '/store/:storeSlug', element: <StorefrontPage /> },
  {
    path: '/',
    element: <ProtectedRoute />,
    children: [
      {
        path: 'companies/new',
        element: <ProtectedRoute allowedRoles={['SuperAdmin', 'Owner']} />,
        children: [{ index: true, element: <CompanyWizard /> }],
      },
      {
        element: <Layout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: '403', element: <NoAccess /> },

          // Phase 20 — AI Business Intelligence Assistant
          {
            element: <RequirePermission permission="reports.view" />,
            children: [{ path: 'ai-assistant', element: <AiAssistantPage /> }],
          },

          // Vyapar Parity Features
          {
            element: <RequirePermission permission="purchases.create" />,
            children: [{ path: 'purchase/scan-bill', element: <ScanBillPage /> }],
          },
          {
            element: <RequirePermission anyOf={['accounting.view', 'settings.view']} />,
            children: [{ path: 'settings/tally', element: <TallySyncPage /> }],
          },
          {
            element: <RequirePermission anyOf={['users.view', 'settings.view']} />,
            children: [{ path: 'salesman-tracking', element: <SalesmanTrackingPage /> }],
          },
          {
            element: <RequirePermission permission="settings.view" />,
            children: [{ path: 'settings/hardware', element: <HardwareSettingsPage /> }],
          },
          {
            element: <RequirePermission permission="settings.view" />,
            children: [{ path: 'settings/online-store', element: <OnlineStorePage /> }],
          },
          {
            element: <RequirePermission permission="settings.view" />,
            children: [{ path: 'marketing/campaigns', element: <CampaignsPage /> }],
          },
          {
            element: <RequirePermission permission="settings.view" />,
            children: [{ path: 'marketing/smart-ads', element: <SmartAdsPage /> }],
          },

          {
            element: <RequirePermission permission="products.view" />,
            children: [
              { path: 'products', element: <ProductsList /> },
              { path: 'products/new', element: <ProductForm /> },
              { path: 'products/:id', element: <ProductForm /> },
              { path: 'products/masters', element: <MastersPage kind="categories" /> },
            ],
          },

          {
            element: <RequirePermission permission="sales.create" />,
            children: [{ path: 'pos', element: <PosScreen /> }],
          },

          {
            element: <RequirePermission permission="customers.view" />,
            children: [
              { path: 'customers', element: <CustomersList /> },
              { path: 'customers/:id', element: <CustomerProfile /> },
            ],
          },

          {
            element: <RequirePermission permission="suppliers.view" />,
            children: [
              { path: 'suppliers', element: <SuppliersList /> },
              { path: 'suppliers/:id', element: <SupplierProfile /> },
            ],
          },

          {
            element: <RequirePermission permission="sales.view" />,
            children: [
              { path: 'sales/quotations', element: <SalesList kind="quotations" /> },
              { path: 'sales/quotations/new', element: <InvoiceForm /> },
              { path: 'sales/quotations/:id', element: <SalesDocumentDetail kind="quotations" /> },
              { path: 'sales/orders', element: <SalesList kind="orders" /> },
              { path: 'sales/orders/new', element: <InvoiceForm /> },
              { path: 'sales/orders/:id', element: <SalesDocumentDetail kind="orders" /> },
              { path: 'sales/invoices', element: <SalesList kind="invoices" /> },
              { path: 'sales/invoices/new', element: <InvoiceForm /> },
              { path: 'sales/invoices/:id', element: <SalesDocumentDetail kind="invoices" /> },
              { path: 'sales/returns/new', element: <ReturnForm /> },
            ],
          },

          {
            element: <RequirePermission permission="purchases.view" />,
            children: [
              { path: 'purchase/orders', element: <PurchaseList kind="orders" /> },
              { path: 'purchase/orders/new', element: <PurchaseForm kind="orders" /> },
              { path: 'purchase/orders/:id', element: <PurchaseDetail kind="orders" /> },
              { path: 'purchase/receipts', element: <PurchaseList kind="grn" /> },
              { path: 'purchase/receipts/new', element: <PurchaseForm kind="grn" /> },
              { path: 'purchase/receipts/:id', element: <PurchaseDetail kind="grn" /> },
              { path: 'purchase/bills', element: <PurchaseList kind="invoices" /> },
              { path: 'purchase/bills/new', element: <PurchaseForm kind="invoices" /> },
              { path: 'purchase/bills/:id', element: <PurchaseDetail kind="invoices" /> },
              { path: 'purchase/returns/new', element: <PurchaseReturnForm /> },
            ],
          },

          {
            element: <RequirePermission permission="inventory.view" />,
            children: [
              { path: 'inventory', element: <InventoryList /> },
              { path: 'inventory/transfer', element: <StockTransfer /> },
              { path: 'inventory/adjust', element: <StockAdjustment /> },
              { path: 'inventory/products/:productId/history', element: <ProductHistory /> },
            ],
          },

          {
            element: <RequirePermission permission="reports.view" />,
            children: [
              { path: 'reports', element: <ReportsHub /> },
              { path: 'reports/sales', element: <SalesReportPage /> },
              { path: 'reports/purchases', element: <PurchaseReportPage /> },
              { path: 'reports/inventory-valuation', element: <InventoryValuationPage /> },
              { path: 'reports/stock-movement', element: <StockMovementReportPage /> },
              { path: 'reports/aging', element: <OutstandingAgingReportPage /> },
              { path: 'reports/product-performance', element: <ProductPerformanceReportPage /> },
              { path: 'reports/trial-balance', element: <TrialBalanceReport /> },
              { path: 'reports/profit-loss', element: <ProfitLossReport /> },
              { path: 'reports/balance-sheet', element: <BalanceSheetReport /> },
              { path: 'reports/day-book', element: <DayBookReport /> },
              { path: 'gst/hsn-summary', element: <HsnSummaryReport /> },
              { path: 'gst/gstr1', element: <Gstr1Report /> },
              { path: 'gst/gstr3b', element: <Gstr3bReport /> },
            ],
          },

          {
            element: <RequirePermission permission="accounting.view" />,
            children: [
              { path: 'accounting/accounts', element: <ChartOfAccounts /> },
              { path: 'accounting/journal-entries', element: <JournalEntries /> },
              { path: 'accounting/ledger', element: <LedgerView mode="account" /> },
            ],
          },

          {
            element: <RequirePermission permission="users.view" />,
            children: [{ path: 'settings/users', element: <SettingsUsers /> }],
          },
          {
            element: <RequirePermission permission="roles.view" />,
            children: [{ path: 'settings/roles', element: <SettingsRoles /> }],
          },
          {
            element: <RequirePermission permission="audit.view" />,
            children: [{ path: 'settings/activity-log', element: <SettingsActivityLog /> }],
          },
          {
            element: <RequirePermission permission="company.update" />,
            children: [{ path: 'settings/company', element: <CompanySettings /> }],
          },
          {
            element: <RequirePermission permission="products.view" />,
            children: [{ path: 'settings/gst-rates', element: <GstRates /> }],
          },
          {
            element: <RequirePermission permission="expenses.view" />,
            children: [
              { path: 'expenses', element: <ExpensesPage /> },
              { path: 'settings/expense-categories', element: <ExpenseCategorySettings /> },
            ],
          },
          {
            element: <RequirePermission permission="banking.view" />,
            children: [
              { path: 'banking/accounts', element: <BankAccountsPage /> },
              { path: 'banking/accounts/:accountId/transactions', element: <BankTransactionsPage /> },
              { path: 'banking/reconciliation', element: <ReconciliationPage /> },
            ],
          },

          // Phase 17 — Notification Settings & History
          {
            element: <RequirePermission permission="settings.view" />,
            children: [
              { path: 'settings/notifications', element: <NotificationSettings /> },
              { path: 'settings/notifications/history', element: <NotificationHistory /> },
            ],
          },

          // Phase 19 — Subscriptions Billing & SuperAdmin Dashboard
          {
            element: <RequirePermission permission="settings.view" />,
            children: [{ path: 'settings/billing', element: <BillingPage /> }],
          },
          {
            element: <ProtectedRoute allowedRoles={['SuperAdmin']} />,
            children: [{ path: 'admin', element: <AdminDashboard /> }],
          },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
