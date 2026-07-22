import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import companyRoutes from './company.routes.js';
import productRoutes from './product.routes.js';
import { brandRoutes, categoryRoutes, unitRoutes } from './catalog.routes.js';
import customerRoutes from './customer.routes.js';
import supplierRoutes from './supplier.routes.js';
import userRoutes from './user.routes.js';
import roleRoutes from './role.routes.js';
import auditLogRoutes from './auditLog.routes.js';
import inventoryRoutes, { warehouseRoutes } from './inventory.routes.js';
import salesRoutes from './sales.routes.js';
import purchaseRoutes from './purchase.routes.js';
import accountingRoutes from './accounting.routes.js';
import reportsRoutes from './reports.routes.js';
import gstRoutes from './gst.routes.js';
import expenseRoutes from './expense.routes.js';
import bankingRoutes from './banking.routes.js';
import { dashboardRouter } from './dashboard.routes.js';
import { notificationRouter } from './notification.routes.js';
import opReportsRouter from './operationalReports.routes.js';
import subscriptionRouter from './subscription.routes.js';
import adminRouter from './admin.routes.js';
import aiRouter from './aiAssistant.routes.js';
import ocrRouter from './ocr.routes.js';
import tallyRouter from './tally.routes.js';
import salesmanRouter from './salesman.routes.js';
import edcRouter from './edc.routes.js';
import onlineStoreRouter, { onlineStorePublicRouter } from './onlineStore.routes.js';
import campaignRouter from './campaign.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/companies', companyRoutes);
router.use('/products', productRoutes);

// Phase 16 — Aggregated Main Dashboard
router.use('/dashboard', dashboardRouter);

// Phase 17 — Multi-Channel Notification Module
router.use('/notifications', notificationRouter);

// Phase 18 — Operational Reports
router.use('/reports/op', opReportsRouter);

// Phase 19 — Subscriptions & SuperAdmin Control Panel
router.use('/subscriptions', subscriptionRouter);
router.use('/admin', adminRouter);

// Phase 20 — AI Assistant Layer & Demand Forecasting
router.use('/ai', aiRouter);

// Vyapar Parity Features
router.use('/purchase', ocrRouter); // POST /api/purchase/scan-ocr
router.use('/tally', tallyRouter); // /api/tally/import & /api/tally/export
router.use('/salesman', salesmanRouter); // /api/salesman/location-ping & /api/salesman/live-locations
router.use('/payments', edcRouter); // POST /api/payments/edc-callback
router.use('/online-store', onlineStoreRouter); // Private store management
router.use('/store', onlineStorePublicRouter); // Public storefront (no auth)
router.use('/campaigns', campaignRouter); // Marketing campaigns & smart ads

// Phase 7 — product masters.
router.use('/categories', categoryRoutes);
router.use('/brands', brandRoutes);
router.use('/units', unitRoutes);

// Phase 5 — customer master and ledger.
router.use('/customers', customerRoutes);

// Phase 6 — supplier master and payable ledger.
router.use('/suppliers', supplierRoutes);

// Phase 8 — inventory.
router.use('/inventory', inventoryRoutes);
router.use('/warehouses', warehouseRoutes);

// Phase 4 — RBAC and user management.
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);
router.use('/audit-logs', auditLogRoutes);

router.use('/sales', salesRoutes);
router.use('/purchase', purchaseRoutes);
router.use('/accounting', accountingRoutes);
router.use('/reports', reportsRoutes);
router.use('/gst', gstRoutes);

// Phase 15 — Expenses & Banking
router.use('/expenses', expenseRoutes);
router.use('/banking', bankingRoutes);

export default router;
