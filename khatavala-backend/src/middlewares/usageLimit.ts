import type { Request, Response, NextFunction } from 'express';
import { getSubscriptionDetails } from '../services/subscription.service.js';
import { ApiError } from '../utils/ApiError.js';

export function enforceUsageLimit(limitType: 'invoices' | 'users' | 'warehouses') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const tenant = req.tenant;
      if (!tenant) {
        throw new ApiError(401, 'Tenant context required');
      }

      const details = await getSubscriptionDetails(tenant);

      if (details.status === 'Expired') {
        throw new ApiError(402, 'Subscription expired. Please upgrade your plan to continue.');
      }

      const { usage } = details;

      if (limitType === 'invoices') {
        if (usage.invoicesThisMonth >= usage.maxInvoices) {
          throw new ApiError(
            402,
            `Monthly invoice creation limit reached (${usage.invoicesThisMonth}/${usage.maxInvoices}). Upgrade to Pro or Enterprise for higher limits.`
          );
        }
      } else if (limitType === 'users') {
        if (usage.usersCount >= usage.maxUsers) {
          throw new ApiError(
            402,
            `User account limit reached (${usage.usersCount}/${usage.maxUsers}). Upgrade your plan to invite more team members.`
          );
        }
      } else if (limitType === 'warehouses') {
        if (usage.warehousesCount >= usage.maxWarehouses) {
          throw new ApiError(
            402,
            `Warehouse limit reached (${usage.warehousesCount}/${usage.maxWarehouses}). Upgrade your plan to add multi-location warehouses.`
          );
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
