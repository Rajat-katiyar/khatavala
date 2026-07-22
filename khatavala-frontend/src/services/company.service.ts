import { api } from './api';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';
import { usePermissionStore } from '@/store/permissionStore';
import { loadPermissions } from './rbac.service';
import type {
  ActivateCompanyPayload,
  ApiResponse,
  Company,
  CompanyMembership,
} from '@/types';

export type CompanyInput = Omit<
  Partial<Company>,
  '_id' | 'ownerId' | 'createdAt' | 'isActive'
> & { name: string };

export async function listCompanies(): Promise<CompanyMembership[]> {
  const { data } = await api.get<ApiResponse<{ companies: CompanyMembership[] }>>(
    '/companies'
  );
  const companies = data.data!.companies;
  useCompanyStore.getState().setMemberships(companies);
  return companies;
}

export async function createCompany(input: CompanyInput): Promise<CompanyMembership> {
  const { data } = await api.post<ApiResponse<CompanyMembership>>('/companies', input);
  const membership = data.data!;
  useCompanyStore
    .getState()
    .setMemberships([...useCompanyStore.getState().memberships, membership]);
  return membership;
}

export async function updateCompany(
  companyId: string,
  input: Partial<CompanyInput>
): Promise<Company> {
  const { data } = await api.patch<ApiResponse<{ company: Company }>>(
    `/companies/${companyId}`,
    input
  );
  const company = data.data!.company;
  useCompanyStore.getState().patchActiveCompany(company);
  return company;
}

/**
 * Switches the active company.
 */
export async function switchCompany(companyId: string): Promise<Company> {
  const { setSwitching, setActiveCompany } = useCompanyStore.getState();
  setSwitching(true);
  try {
    const { data } = await api.post<ApiResponse<ActivateCompanyPayload>>(
      `/companies/${companyId}/activate`
    );
    const payload = data.data!;

    useAuthStore.getState().setAccessToken(payload.accessToken);
    setActiveCompany(payload.company, payload.role);

    usePermissionStore.getState().reset();
    await loadPermissions();

    return payload.company;
  } finally {
    setSwitching(false);
  }
}

/**
 * Loads the user's companies on app start and makes sure exactly one is active.
 * Guarantees permission resolution finishes cleanly without leaving the store un-loaded.
 */
export async function bootstrapCompanies(): Promise<CompanyMembership[]> {
  try {
    const memberships = await listCompanies();
    if (memberships.length === 0) {
      useCompanyStore.getState().reset();
      usePermissionStore.getState().setPermissions('None', []);
      return memberships;
    }

    const persistedId = useCompanyStore.getState().activeCompany?._id;
    const target =
      memberships.find((m) => m.company._id === persistedId) ?? memberships[0];

    await switchCompany(target.company._id);
    return memberships;
  } catch (err) {
    usePermissionStore.getState().setPermissions('None', []);
    throw err;
  }
}
