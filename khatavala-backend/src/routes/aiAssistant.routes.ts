import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as aiService from '../services/aiAssistant.service.js';

const router = Router();

router.use(authenticate, resolveTenant, requireTenant);

router.post(
  '/ask',
  asyncHandler(async (req, res) => {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      res.status(400).json({ success: false, error: 'Question string is required' });
      return;
    }
    const result = await aiService.answerBusinessQuestion(req.tenant!, question);
    res.json({ success: true, data: result });
  })
);

router.get(
  '/demand-forecast',
  asyncHandler(async (req, res) => {
    const forecast = await aiService.getDemandForecast(req.tenant!);
    res.json({ success: true, data: forecast });
  })
);

export default router;
