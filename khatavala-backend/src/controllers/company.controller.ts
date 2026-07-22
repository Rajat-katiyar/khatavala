import type { Request, Response } from 'express';
import * as companyService from '../services/company.service.js';

export async function create(req: Request, res: Response) {
  const data = await companyService.createCompany(req.user!.id, req.body);
  res.status(201).json({ success: true, data });
}

// Companies the caller is a member of — the source for the company switcher.
export async function list(req: Request, res: Response) {
  const companies = await companyService.listCompaniesForUser(req.user!.id);
  res.json({ success: true, data: { companies } });
}

export async function getById(req: Request, res: Response) {
  const data = await companyService.getCompany(req.user!.id, req.params.id);
  res.json({ success: true, data });
}

// Edits the ACTIVE company, not the one named in the path — see the service.
export async function update(req: Request, res: Response) {
  const data = await companyService.updateCompany(req.tenant!, req.body);
  res.json({ success: true, data });
}

// Returns a fresh access token carrying the new companyId claim. The client
// swaps its stored token for this one; the refresh token is unchanged.
export async function activate(req: Request, res: Response) {
  const data = await companyService.setActiveCompany(req.user!.id, req.params.id);
  res.json({ success: true, data });
}
