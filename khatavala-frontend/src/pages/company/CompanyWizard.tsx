import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import * as companyService from '@/services/company.service';
import { MONTHS } from '@/types';
import { cn } from '@/lib/utils';

// Per-step schemas. Validating a step in isolation is what lets "Next" block on
// that step's fields only — a single whole-form schema would reject step 1 for
// fields the user has not reached yet.
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const optionalText = (schema: z.ZodString) =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || schema.safeParse(v).success, 'Invalid value');

const stepSchemas = [
  z.object({
    name: z.string().trim().min(2, 'Company name is required').max(160),
    state: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    line1: z.string().trim().max(160).optional(),
    pincode: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || /^[1-9][0-9]{5}$/.test(v), 'Enter a valid 6-digit pincode'),
  }),
  z.object({
    gstNumber: optionalText(z.string().regex(gstinPattern)),
    panNumber: optionalText(z.string().regex(panPattern)),
  }),
  z.object({
    financialYearStart: z.coerce.number().int().min(1).max(12),
    currency: z.string().trim().length(3, 'Use a 3-letter code, e.g. INR'),
    timeZone: z.string().trim().min(1, 'Time zone is required'),
    invoicePrefix: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,10}$/, 'Letters, digits and hyphens only'),
  }),
  z.object({
    logoUrl: z
      .string()
      .trim()
      .optional()
      .refine(
        (v) => !v || z.string().url().safeParse(v).success,
        'Enter a valid image URL'
      ),
  }),
];

const STEPS = [
  { title: 'Basic info', description: 'Name and registered address' },
  { title: 'GST & PAN', description: 'Tax registration details' },
  { title: 'Financial year', description: 'Accounting and invoicing defaults' },
  { title: 'Logo', description: 'Optional branding' },
];

type FormValues = Record<string, string>;

const INITIAL: FormValues = {
  name: '',
  state: '',
  city: '',
  line1: '',
  pincode: '',
  gstNumber: '',
  panNumber: '',
  financialYearStart: '4',
  currency: 'INR',
  timeZone: 'Asia/Kolkata',
  invoicePrefix: 'INV',
  logoUrl: '',
};

export function CompanyWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<FormValues>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field: string) => (event: React.ChangeEvent<HTMLElement>) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    setValues((prev) => ({ ...prev, [field]: target.value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const validateStep = (index: number): boolean => {
    const result = stepSchemas[index].safeParse(values);
    if (result.success) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0]);
      next[key] = next[key] ?? issue.message;
    }
    setErrors(next);
    return false;
  };

  const handleNext = () => {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleSubmit = async () => {
    // Re-validate every step: a user can reach the last step and then go back
    // and clear a required field.
    for (let i = 0; i < stepSchemas.length; i += 1) {
      if (!validateStep(i)) return setStep(i);
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      // Only send fields the user actually filled — the backend validates the
      // format of anything it receives, so empty strings would be rejected.
      const address = {
        ...(values.line1 && { line1: values.line1 }),
        ...(values.city && { city: values.city }),
        ...(values.pincode && { pincode: values.pincode }),
      };

      const membership = await companyService.createCompany({
        name: values.name,
        ...(values.state && { state: values.state }),
        ...(Object.keys(address).length > 0 && { address }),
        ...(values.gstNumber && { gstNumber: values.gstNumber.toUpperCase() }),
        ...(values.panNumber && { panNumber: values.panNumber.toUpperCase() }),
        financialYearStart: Number(values.financialYearStart),
        currency: values.currency.toUpperCase(),
        timeZone: values.timeZone,
        invoicePrefix: values.invoicePrefix.toUpperCase(),
        ...(values.logoUrl && { logoUrl: values.logoUrl }),
      });

      // Make the new company active immediately — creating a company and then
      // still looking at the previous one's data is a confusing landing.
      await companyService.switchCompany(membership.company._id);
      navigate('/', { replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create company');
    } finally {
      setSubmitting(false);
    }
  };

  const field = (name: string, label: string, props: React.ComponentProps<'input'> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} value={values[name]} onChange={set(name)} {...props} />
      {errors[name] && <p className="text-xs text-destructive">{errors[name]}</p>}
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Create a company</CardTitle>
          <CardDescription>
            Step {step + 1} of {STEPS.length} — {STEPS[step].description}
          </CardDescription>

          <ol className="mt-4 flex gap-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex-1">
                <div
                  className={cn(
                    'h-1 rounded-full',
                    i <= step ? 'bg-primary' : 'bg-muted'
                  )}
                />
                <span
                  className={cn(
                    'mt-1.5 block text-xs',
                    i === step
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  {s.title}
                </span>
              </li>
            ))}
          </ol>
        </CardHeader>

        <CardContent className="space-y-4">
          {step === 0 && (
            <>
              {field('name', 'Company name', { placeholder: 'Acme Traders Pvt Ltd' })}
              {field('line1', 'Address', { placeholder: '12 MG Road' })}
              <div className="grid gap-4 sm:grid-cols-3">
                {field('city', 'City', { placeholder: 'Pune' })}
                {field('state', 'State', { placeholder: 'Maharashtra' })}
                {field('pincode', 'Pincode', { placeholder: '411001' })}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              {field('gstNumber', 'GSTIN', {
                placeholder: '27AAAPA1234A1Z5',
                maxLength: 15,
                className: 'uppercase',
              })}
              {field('panNumber', 'PAN', {
                placeholder: 'AAAPA1234A',
                maxLength: 10,
                className: 'uppercase',
              })}
              <p className="text-xs text-muted-foreground">
                Both are optional — you can add them later from company settings if
                registration is still in progress.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="financialYearStart">Financial year starts</Label>
                <select
                  id="financialYearStart"
                  value={values.financialYearStart}
                  onChange={set('financialYearStart')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {MONTHS.map((month, i) => (
                    <option key={month} value={i + 1}>
                      {month}
                    </option>
                  ))}
                </select>
                {errors.financialYearStart && (
                  <p className="text-xs text-destructive">{errors.financialYearStart}</p>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {field('currency', 'Currency', { maxLength: 3, className: 'uppercase' })}
                {field('timeZone', 'Time zone')}
              </div>
              {field('invoicePrefix', 'Invoice prefix', {
                maxLength: 10,
                className: 'uppercase',
              })}
              <p className="text-xs text-muted-foreground">
                Invoices will be numbered {values.invoicePrefix || 'INV'}-0001, and so on.
              </p>
            </>
          )}

          {step === 3 && (
            <>
              {field('logoUrl', 'Logo URL', {
                placeholder: 'https://example.com/logo.png',
              })}
              {values.logoUrl && !errors.logoUrl && (
                <img
                  src={values.logoUrl}
                  alt="Logo preview"
                  className="h-20 w-20 rounded border object-contain p-1"
                />
              )}
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-medium">{values.name || 'Untitled company'}</p>
                <p className="text-muted-foreground">
                  {values.gstNumber || 'No GSTIN'} ·{' '}
                  {MONTHS[Number(values.financialYearStart) - 1]} FY start ·{' '}
                  {values.currency}
                </p>
              </div>
            </>
          )}

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}

          <div className="flex justify-between pt-2">
            <Button
              variant="outline"
              onClick={() => (step === 0 ? navigate(-1) : setStep((s) => s - 1))}
              disabled={submitting}
            >
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>

            {step < STEPS.length - 1 ? (
              <Button onClick={handleNext}>Next</Button>
            ) : (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Creating…' : 'Create company'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
