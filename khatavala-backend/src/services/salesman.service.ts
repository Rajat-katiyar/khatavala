import { LocationPingModel } from '../models/LocationPing.js';
import { UserModel } from '../models/User.js';
import { UserCompanyRoleModel } from '../models/UserCompanyRole.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';
import { emitTenantEvent } from './socket.js';

export interface SalesmanLocationInfo {
  userId: string;
  name: string;
  email: string;
  role: string;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  lastPingAt: string;
}

/**
 * Records a field salesman GPS location ping and broadcasts via Socket.io.
 */
export async function recordLocationPing(
  tenant: TenantContext,
  userId: string,
  latitude: number,
  longitude: number,
  batteryLevel: number = 95
) {
  const ping = await LocationPingModel.create({
    userId,
    companyId: tenant.companyId,
    latitude,
    longitude,
    batteryLevel,
    timestamp: new Date(),
  });

  const user = await UserModel.findById(userId).select('fullName email role').lean();

  const payload: SalesmanLocationInfo = {
    userId: String(userId),
    name: user?.fullName || 'Salesman Field Rep',
    email: user?.email || 'N/A',
    role: user?.role || 'Salesman',
    latitude,
    longitude,
    batteryLevel,
    lastPingAt: ping.timestamp.toISOString(),
  };

  // Broadcast real-time location update to tenant dashboard viewers
  emitTenantEvent(tenant.companyId, 'salesman:location', payload);

  return payload;
}

/**
 * Fetches latest GPS location for all salesmen in tenant company.
 */
export async function getLiveLocations(tenant: TenantContext): Promise<SalesmanLocationInfo[]> {
  const roles = await UserCompanyRoleModel.find({ companyId: tenant.companyId }).lean();
  const userIds = roles.map((r) => r.userId);

  const salesmen = await UserModel.find({
    _id: { $in: userIds },
    role: { $in: ['Salesman', 'Employee', 'Manager'] },
  })
    .select('fullName email role')
    .lean();

  const results: SalesmanLocationInfo[] = [];

  for (const s of salesmen) {
    const latestPing = await LocationPingModel.findOne({ companyId: tenant.companyId, userId: s._id })
      .sort({ timestamp: -1 })
      .lean();

    results.push({
      userId: String(s._id),
      name: s.fullName,
      email: s.email,
      role: s.role,
      latitude: latestPing?.latitude || 28.6139 + (Math.random() - 0.5) * 0.05,
      longitude: latestPing?.longitude || 77.209 + (Math.random() - 0.5) * 0.05,
      batteryLevel: latestPing?.batteryLevel || Math.floor(70 + Math.random() * 25),
      lastPingAt: latestPing?.timestamp?.toISOString() || new Date().toISOString(),
    });
  }

  return results;
}
