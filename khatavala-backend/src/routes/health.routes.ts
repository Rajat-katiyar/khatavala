import { Router } from 'express';
import { healthCheck } from '../controllers/health.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(healthCheck));

export default router;
