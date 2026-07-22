import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parseScannedInvoiceImage } from '../services/ocr.service.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // Max 10MB
const router = Router();

router.use(authenticate, resolveTenant, requireTenant);

router.post(
  '/scan-ocr',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'Invoice image file is required' });
      return;
    }

    const draft = await parseScannedInvoiceImage(req.file.buffer);
    res.json({ success: true, data: draft });
  })
);

export default router;
