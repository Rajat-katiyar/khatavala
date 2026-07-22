import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Company, CompanyMembership, Role } from '@/types';

interface CompanyState {
  memberships: CompanyMembership[];
  activeCompany: Company | null;
  activeRole: Role | null;

  /**
   * Bumped on every company switch. Data hooks list it as an effect dependency
   * so they refetch under the new tenant — without it, a switch would leave the
   * previous company's rows on screen.
   */
  tenantVersion: number;

  isSwitching: boolean;

  setMemberships: (memberships: CompanyMembership[]) => void;
  setActiveCompany: (company: Company, role: Role) => void;
  patchActiveCompany: (company: Company) => void;
  setSwitching: (isSwitching: boolean) => void;
  reset: () => void;
}

export const useCompanyStore = create<CompanyState>()(
  persist(
    (set) => ({
      memberships: [],
      activeCompany: null,
      activeRole: null,
      tenantVersion: 0,
      isSwitching: false,

      setMemberships: (memberships) => set({ memberships }),

      setActiveCompany: (company, role) =>
        set((state) => ({
          activeCompany: company,
          activeRole: role,
          tenantVersion: state.tenantVersion + 1,
        })),

      // Profile edits: refresh the active company and the matching list entry
      // so the switcher label updates too, but do NOT bump tenantVersion —
      // the tenant is unchanged, so there is nothing to refetch.
      patchActiveCompany: (company) =>
        set((state) => ({
          activeCompany: company,
          memberships: state.memberships.map((m) =>
            m.company._id === company._id ? { ...m, company } : m
          ),
        })),

      setSwitching: (isSwitching) => set({ isSwitching }),

      reset: () =>
        set({
          memberships: [],
          activeCompany: null,
          activeRole: null,
          tenantVersion: 0,
          isSwitching: false,
        }),
    }),
    {
      name: 'khatavala-company',
      partialize: (state) => ({
        activeCompany: state.activeCompany,
        activeRole: state.activeRole,
      }),
    }
  )
);
