import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

export const ROLES = [
  'SuperAdmin',
  'Owner',
  'Manager',
  'Cashier',
  'Accountant',
  'StoreKeeper',
  'Salesman',
  'Employee',
] as const;

export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true },
    phoneNumber: { type: String, trim: true },
    role: { type: String, enum: ROLES, default: 'Employee', required: true },
    isActive: { type: Boolean, default: true },

    // Password reset: only the SHA-256 hash of the emailed token is stored.
    resetTokenHash: { type: String, select: false },
    resetTokenExpiresAt: { type: Date, select: false },

    // Bumped on "revoke all sessions" / password reset so older refresh
    // tokens fail verification even before their DB record is checked.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.passwordHash;
    delete ret.resetTokenHash;
    delete ret.resetTokenExpiresAt;
    delete ret.tokenVersion;
    delete ret.__v;
    return ret;
  },
});

// Automatic bcrypt password hashing pre-save hook
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  // Do not re-hash if it is already a valid bcrypt hash
  if (
    this.passwordHash &&
    (this.passwordHash.startsWith('$2b$') || this.passwordHash.startsWith('$2a$'))
  ) {
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(env.BCRYPT_ROUNDS || 12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (err: any) {
    next(err);
  }
});

userSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  if (!this.passwordHash) return false;

  // Auto-recovery for any plain-text passwords created prior to fix
  if (
    !this.passwordHash.startsWith('$2b$') &&
    !this.passwordHash.startsWith('$2a$')
  ) {
    if (candidatePassword === this.passwordHash) {
      // Auto-encrypt plain text password to bcrypt hash in DB on successful login
      try {
        const salt = await bcrypt.genSalt(env.BCRYPT_ROUNDS || 12);
        this.passwordHash = await bcrypt.hash(candidatePassword, salt);
        await this.save();
      } catch {
        // ignore save error
      }
      return true;
    }
    return false;
  }

  return bcrypt.compare(candidatePassword, this.passwordHash);
};

userSchema.statics.hashPassword = async function (password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS || 12);
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS || 12);
}

export type IUser = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<
  IUser,
  { comparePassword(pwd: string): Promise<boolean> }
>;

export interface IUserModel extends Schema<IUser> {}

export const UserModel = model<IUser>('User', userSchema);
