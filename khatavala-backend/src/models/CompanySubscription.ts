import { Schema, model, type InferSchemaType } from 'mongoose';

export type SubscriptionStatus = 'Trial' | 'Active' | 'Expired' | 'Cancelled';

const companySubscriptionSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      unique: true,
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'SubscriptionPlan',
      required: true,
    },
    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, required: true },
    status: {
      type: String,
      required: true,
      enum: ['Trial', 'Active', 'Expired', 'Cancelled'],
      default: 'Trial',
    },
    paymentReference: { type: String, trim: true },
    razorpayOrderId: { type: String, trim: true },
    razorpayPaymentId: { type: String, trim: true },
  },
  { timestamps: true }
);

export type ICompanySubscription = InferSchemaType<typeof companySubscriptionSchema>;
export const CompanySubscriptionModel = model('CompanySubscription', companySubscriptionSchema);
