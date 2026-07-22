import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * OnlineStore — one public storefront per company.
 * Accessible at /store/:storeSlug without authentication.
 */
const onlineStoreSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      unique: true,
      index: true,
    },
    storeSlug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9-]+$/,
    },
    storeName: { type: String, required: true, trim: true },
    tagline: { type: String, trim: true, default: null },
    logoUrl: { type: String, trim: true, default: null },
    bannerUrl: { type: String, trim: true, default: null },
    themeColor: { type: String, default: '#6366f1' },
    whatsappNumber: { type: String, trim: true, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type IOnlineStore = InferSchemaType<typeof onlineStoreSchema>;
export const OnlineStoreModel = model('OnlineStore', onlineStoreSchema);
