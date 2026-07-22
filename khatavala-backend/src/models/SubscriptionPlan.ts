import { Schema, model, type InferSchemaType } from 'mongoose';

export type PlanName = 'Trial' | 'Basic' | 'Pro' | 'Enterprise';
export type BillingCycle = 'Monthly' | 'Yearly';

const subscriptionPlanSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      enum: ['Trial', 'Basic', 'Pro', 'Enterprise'],
    },
    price: { type: Number, required: true, min: 0 },
    billingCycle: { type: String, required: true, enum: ['Monthly', 'Yearly'], default: 'Monthly' },
    maxUsers: { type: Number, required: true, default: 3 },
    maxInvoicesPerMonth: { type: Number, required: true, default: 50 },
    maxWarehouses: { type: Number, required: true, default: 1 },
    featureFlags: {
      posTerminal: { type: Boolean, default: true },
      multiWarehouse: { type: Boolean, default: false },
      customTemplates: { type: Boolean, default: false },
      apiAccess: { type: Boolean, default: false },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type ISubscriptionPlan = InferSchemaType<typeof subscriptionPlanSchema>;
export const SubscriptionPlanModel = model('SubscriptionPlan', subscriptionPlanSchema);
