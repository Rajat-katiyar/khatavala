import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import { recordAudit } from '../services/audit.service.js';
import * as accountService from '../services/account.service.js';
import * as journalService from '../services/journal.service.js';
import * as reports from '../services/accountingReports.service.js';
import {
  accountListQuerySchema,
  createAccountSchema,
  createContraEntrySchema,
  createJournalEntrySchema,
  journalListQuerySchema,
  ledgerQuerySchema,
  trialBalanceQuerySchema,
  updateAccountSchema,
} from '../validators/accounting.validators.js';

/**
 * Phase 12 — accounting. Replaces the Phase 4 permission-demo placeholder.
 *
 * Note what is NOT here: any endpoint that writes a journal entry for a sales
 * invoice, a bill or a payment. Those are posted automatically inside the
 * transaction of the operation that caused them (see journal.service), and
 * exposing a manual route for them would allow the books to be edited out from
 * under the documents — the exact drift this module exists to prevent.
 *
 * What IS writable: the chart of accounts, manual journals, and contra entries.
 */

const router = Router();
router.use(authenticate, resolveTenant, requireTenant);

/* ------------------------ Chart of accounts ------------------------ */

const accountRouter = Router();

accountRouter.get(
  '/',
  requirePermission('accounting', 'view'),
  validate(accountListQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const accounts = await accountService.listAccounts(req.tenant!, req.query);
    res.json({ success: true, data: { accounts } });
  })
);

/**
 * The chart as a tree. Declared before `/:id` so it is not read as an id.
 *
 * Calls `ensureDefaultAccounts` first, so opening the screen on a company that
 * has never traded shows the standard chart rather than an empty page the user
 * cannot act on.
 */
accountRouter.get(
  '/tree',
  requirePermission('accounting', 'view'),
  asyncHandler(async (req, res) => {
    await accountService.ensureDefaultAccounts(req.tenant!);
    const tree = await accountService.getAccountTree(
      req.tenant!,
      req.query.includeInactive === 'true'
    );
    res.json({ success: true, data: { tree } });
  })
);

accountRouter.post(
  '/',
  requirePermission('accounting', 'create'),
  validate(createAccountSchema),
  asyncHandler(async (req, res) => {
    const account = await accountService.createAccount(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'Account',
      entityId: String(account._id),
      newValue: account,
    });
    res.status(201).json({ success: true, data: { account } });
  })
);

accountRouter.get(
  '/:id',
  requirePermission('accounting', 'view'),
  asyncHandler(async (req, res) => {
    const account = await accountService.getAccount(req.tenant!, req.params.id);
    res.json({ success: true, data: { account } });
  })
);

accountRouter.patch(
  '/:id',
  requirePermission('accounting', 'update'),
  validate(updateAccountSchema),
  asyncHandler(async (req, res) => {
    const before = await accountService.getAccount(req.tenant!, req.params.id);
    const account = await accountService.updateAccount(
      req.tenant!,
      req.params.id,
      req.body
    );
    await recordAudit(req.tenant!, {
      action: 'update',
      entityName: 'Account',
      entityId: req.params.id,
      oldValue: before,
      newValue: account,
    });
    res.json({ success: true, data: { account } });
  })
);

accountRouter.delete(
  '/:id',
  requirePermission('accounting', 'delete'),
  asyncHandler(async (req, res) => {
    const before = await accountService.getAccount(req.tenant!, req.params.id);
    const result = await accountService.deleteAccount(req.tenant!, req.params.id);
    await recordAudit(req.tenant!, {
      // An account with postings is deactivated, not deleted — the audit trail
      // records which actually happened.
      action: result.deleted ? 'delete' : 'update',
      entityName: 'Account',
      entityId: req.params.id,
      oldValue: before,
    });
    res.json({ success: true, data: result });
  })
);

/* -------------------------- Journal entries ------------------------ */

const journalRouter = Router();

journalRouter.get(
  '/',
  requirePermission('accounting', 'view'),
  validate(journalListQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await journalService.listJournalEntries(req.tenant!, req.query);
    res.json({ success: true, data: result });
  })
);

journalRouter.post(
  '/',
  requirePermission('accounting', 'create'),
  validate(createJournalEntrySchema),
  asyncHandler(async (req, res) => {
    const entry = await journalService.createManualJournalEntry(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'JournalEntry',
      entityId: String(entry._id),
      newValue: {
        documentNumber: entry.documentNumber,
        totalDebit: entry.totalDebit,
        narration: entry.narration,
      },
    });
    res.status(201).json({ success: true, data: { entry } });
  })
);

/** Cash ↔ bank. Its own endpoint because it is frequent and easy to reverse. */
journalRouter.post(
  '/contra',
  requirePermission('accounting', 'create'),
  validate(createContraEntrySchema),
  asyncHandler(async (req, res) => {
    const entry = await journalService.createContraEntry(req.tenant!, req.body);
    await recordAudit(req.tenant!, {
      action: 'create',
      entityName: 'JournalEntry',
      entityId: String(entry._id),
      newValue: { documentNumber: entry.documentNumber, contra: req.body },
    });
    res.status(201).json({ success: true, data: { entry } });
  })
);

journalRouter.get(
  '/:id',
  requirePermission('accounting', 'view'),
  asyncHandler(async (req, res) => {
    const entry = await journalService.getJournalEntry(req.tenant!, req.params.id);
    res.json({ success: true, data: { entry } });
  })
);

/* ------------------------------ Reports ---------------------------- */

router.get(
  '/cash-book',
  requirePermission('accounting', 'view'),
  validate(ledgerQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const book = await reports.getCashBook(req.tenant!, req.query);
    res.json({ success: true, data: book });
  })
);

router.get(
  '/bank-book',
  requirePermission('accounting', 'view'),
  validate(ledgerQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const book = await reports.getBankBook(req.tenant!, req.query);
    res.json({ success: true, data: book });
  })
);

router.get(
  '/trial-balance',
  requirePermission('accounting', 'view'),
  validate(trialBalanceQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const trialBalance = await reports.getTrialBalance(req.tenant!, req.query);
    res.json({ success: true, data: trialBalance });
  })
);

router.get(
  '/ledger/:accountId',
  requirePermission('accounting', 'view'),
  validate(ledgerQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const ledger = await reports.getAccountLedger(
      req.tenant!,
      req.params.accountId,
      req.query
    );
    res.json({ success: true, data: ledger });
  })
);

router.use('/accounts', accountRouter);
router.use('/journal-entries', journalRouter);

export default router;
