import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as campaignService from '../services/campaign.service.js';

const router = Router();
router.use(authenticate, resolveTenant, requireTenant);

// CRUD
router.get('/', asyncHandler(async (req, res) => {
  const campaigns = await campaignService.listCampaigns(req.tenant!);
  res.json({ success: true, data: campaigns });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const campaign = await campaignService.getCampaign(req.tenant!, req.params.id);
  res.json({ success: true, data: campaign });
}));

router.post('/', asyncHandler(async (req, res) => {
  const campaign = await campaignService.createCampaign(req.tenant!, req.body);
  res.status(201).json({ success: true, data: campaign });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const campaign = await campaignService.updateCampaign(req.tenant!, req.params.id, req.body);
  res.json({ success: true, data: campaign });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await campaignService.deleteCampaign(req.tenant!, req.params.id);
  res.json({ success: true, message: 'Campaign deleted' });
}));

// Send campaign immediately
router.post('/:id/send', asyncHandler(async (req, res) => {
  const result = await campaignService.sendCampaign(req.tenant!, req.params.id);
  res.json({ success: true, data: result });
}));

// Delivery report
router.get('/:id/report', asyncHandler(async (req, res) => {
  const report = await campaignService.getCampaignReport(req.tenant!, req.params.id);
  res.json({ success: true, data: report });
}));

// Smart ad copy generator
router.post('/smart-ads/generate', asyncHandler(async (req, res) => {
  const { productName, sellingPrice, mrp, description } = req.body;
  const variants = await campaignService.generateAdCopy(
    req.tenant!,
    productName,
    Number(sellingPrice),
    mrp ? Number(mrp) : undefined,
    description
  );
  res.json({ success: true, data: { variants } });
}));

export default router;
