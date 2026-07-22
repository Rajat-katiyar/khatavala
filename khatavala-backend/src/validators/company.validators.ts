import { z } from 'zod';

const gstNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/,
    'Enter a valid 15-character GSTIN'
  );

const panNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid 10-character PAN');

const address = z.object({
  line1: z.string().trim().max(160).optional(),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit pincode')
    .optional(),
});

const companyFields = {
  name: z.string().trim().min(2, 'Company name is required').max(160),
  gstNumber: gstNumber.optional(),
  panNumber: panNumber.optional(),
  address: address.optional(),
  state: z.string().trim().max(80).optional(),
  // Month index: 4 = April, the standard Indian financial year start.
  financialYearStart: z.coerce.number().int().min(1).max(12).optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  timeZone: z.string().trim().max(64).optional(),
  logoUrl: z.string().trim().url('Logo must be a valid URL').max(2048).optional(),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, 'Prefix may use letters, digits and hyphens')
    .optional(),
};

export const createCompanySchema = z.object(companyFields);

// Every field optional on update, but at least one must be present — an empty
// PATCH body would otherwise silently succeed while changing nothing.
export const updateCompanySchema = z
  .object({
    name: companyFields.name.optional(),
    gstNumber: gstNumber.optional(),
    panNumber: panNumber.optional(),
    address: address.optional(),
    state: companyFields.state,
    financialYearStart: companyFields.financialYearStart,
    currency: companyFields.currency,
    timeZone: companyFields.timeZone,
    logoUrl: companyFields.logoUrl,
    invoicePrefix: companyFields.invoicePrefix,
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const companyIdSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid company id'),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
