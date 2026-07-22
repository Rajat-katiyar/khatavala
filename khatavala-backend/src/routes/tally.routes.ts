import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as tallyService from '../services/tally.service.js';

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });
const router = Router();

router.use(authenticate, resolveTenant, requireTenant);

router.post(
  '/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    let content = '';
    if (req.file) {
      content = req.file.buffer.toString('utf-8');
    } else if (req.body?.content) {
      content = req.body.content;
    } else {
      res.status(400).json({ success: false, error: 'Tally XML or CSV file is required' });
      return;
    }

    const summary = await tallyService.importTallyData(req.tenant!, content);
    res.json({ success: true, data: summary });
  })
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const xml = await tallyService.exportToTallyXml(req.tenant!);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="khatavala_tally_export.xml"');
    res.send(xml);
  })
);

export default router;
