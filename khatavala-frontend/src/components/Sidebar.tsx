import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Package,
  FileText,
  Calculator,
  ShoppingBag,
  Boxes,
  BarChart3,
  Percent,
  BookOpen,
  Receipt,
  Landmark,
  Users,
  Truck,
  UserCheck,
  ShieldCheck,
  History,
  ChevronLeft,
  ChevronRight,
  Store,
  Bell,
  CreditCard,
  ShieldAlert,
  Sparkles,
  Camera,
  FileCode,
  MapPin,
  Cpu,
  Megaphone,
} from 'lucide-react';
import { useCompanyStore } from '@/store/companyStore';
import { useAuthStore } from '@/store/authStore';
import { usePermissionStore } from '@/store/permissionStore';
import type { Permission } from '@/types';

interface NavItem {
  to: string;
  label: string;
  icon: any;
  iconColor?: string;
  end?: boolean;
  permission?: Permission;
  anyOf?: Permission[];
  isSuperAdmin?: boolean;
  alwaysVisible?: boolean;
  badge?: {
    text: string;
    className: string;
  };
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();

  const can = usePermissionStore((s) => s.can);
  const canAny = usePermissionStore((s) => s.canAny);
  usePermissionStore((s) => s.permissions);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors font-medium ${isActive
      ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
    } ${collapsed ? 'justify-center px-2' : ''}`;

  // Helper function to check item visibility based on roles/permissions
  const isItemVisible = (item: NavItem) => {
    if (item.alwaysVisible) return true;
    if (item.isSuperAdmin) return user?.role === 'SuperAdmin';
    if (item.permission) return can(item.permission);
    if (item.anyOf) return canAny(...item.anyOf);
    return false;
  };

  const navSections: NavSection[] = [
    {
      title: 'Overview',
      items: [
        {
          to: '/',
          label: 'Dashboard',
          icon: LayoutDashboard,
          end: true,
          alwaysVisible: true,
        },
        {
          to: '/ai-assistant',
          label: 'AI Assistant',
          icon: Sparkles,
          iconColor: 'text-primary',
          permission: 'reports.view',
          badge: { text: 'Smart', className: 'bg-primary/10 text-primary' },
        },
        {
          to: '/salesman-tracking',
          label: 'Salesman GPS',
          icon: MapPin,
          iconColor: 'text-rose-500',
          anyOf: ['users.view', 'settings.view'],
        },
        {
          to: '/pos',
          label: 'POS Terminal',
          icon: Calculator,
          iconColor: 'text-amber-500',
          permission: 'sales.create',
          badge: {
            text: 'Fast',
            className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
          },
        },
      ],
    },
    {
      title: 'Sales & Purchases',
      items: [
        {
          to: '/products',
          label: 'Products',
          icon: Package,
          permission: 'products.view',
        },
        {
          to: '/sales/invoices',
          label: 'Invoices',
          icon: FileText,
          permission: 'sales.view',
        },
        {
          to: '/purchase/orders',
          label: 'Purchases',
          icon: ShoppingBag,
          permission: 'purchases.view',
        },
        {
          to: '/purchase/scan-bill',
          label: 'Scan OCR Bill',
          icon: Camera,
          iconColor: 'text-blue-500',
          permission: 'purchases.create',
        },
        {
          to: '/inventory',
          label: 'Inventory',
          icon: Boxes,
          permission: 'inventory.view',
        },
      ],
    },
    {
      title: 'Financials & Tax',
      items: [
        {
          to: '/reports',
          label: 'Reports',
          icon: BarChart3,
          end: true,
          permission: 'reports.view',
        },
        {
          to: '/gst/hsn-summary',
          label: 'GST Compliance',
          icon: Percent,
          permission: 'reports.view',
        },
        {
          to: '/accounting/journal-entries',
          label: 'Accounts',
          icon: BookOpen,
          permission: 'accounting.view',
        },
        {
          to: '/expenses',
          label: 'Expenses',
          icon: Receipt,
          permission: 'expenses.view',
        },
        {
          to: '/banking/accounts',
          label: 'Banking',
          icon: Landmark,
          permission: 'banking.view',
        },
      ],
    },
    {
      title: 'Parties',
      items: [
        {
          to: '/customers',
          label: 'Customers',
          icon: Users,
          permission: 'customers.view',
        },
        {
          to: '/suppliers',
          label: 'Suppliers',
          icon: Truck,
          permission: 'suppliers.view',
        },
      ],
    },
    {
      title: 'Settings & Admin',
      items: [
        {
          to: '/settings/hardware',
          label: t('nav.hardware') || 'Hardware Settings',
          icon: Cpu,
          iconColor: 'text-blue-500',
          permission: 'settings.view',
        },
        {
          to: '/settings/tally',
          label: 'Tally ERP Sync',
          icon: FileCode,
          iconColor: 'text-amber-500',
          anyOf: ['accounting.view', 'settings.view'],
        },
        {
          to: '/settings/online-store',
          label: 'Online Store',
          icon: Store,
          iconColor: 'text-indigo-500',
          permission: 'settings.view',
        },
        {
          to: '/marketing/campaigns',
          label: 'WhatsApp Marketing',
          icon: Megaphone,
          iconColor: 'text-emerald-500',
          permission: 'settings.view',
        },
        {
          to: '/marketing/smart-ads',
          label: 'Smart Ads Generator',
          icon: Sparkles,
          iconColor: 'text-purple-500',
          permission: 'settings.view',
        },
        {
          to: '/settings/billing',
          label: 'Billing & Plans',
          icon: CreditCard,
          iconColor: 'text-emerald-500',
          permission: 'settings.view',
        },
        {
          to: '/settings/notifications',
          label: 'Notifications',
          icon: Bell,
          iconColor: 'text-indigo-500',
          permission: 'settings.view',
        },
        {
          to: '/admin',
          label: 'SuperAdmin',
          icon: ShieldAlert,
          iconColor: 'text-rose-500',
          isSuperAdmin: true,
        },
        {
          to: '/settings/users',
          label: 'Users',
          icon: UserCheck,
          permission: 'users.view',
        },
        {
          to: '/settings/roles',
          label: 'Roles',
          icon: ShieldCheck,
          permission: 'roles.view',
        },
        {
          to: '/settings/activity-log',
          label: 'Activity Log',
          icon: History,
          permission: 'audit.view',
        },
      ],
    },
  ];

  return (
    <aside
      className={`sticky top-0 h-screen flex flex-col border-r bg-card text-card-foreground transition-all duration-300 select-none shrink-0 z-20 overflow-y-auto ${collapsed ? 'w-16' : 'w-64'
        }`}
    >
      {/* Sidebar Header / Brand */}
      <div className="flex h-14 items-center justify-between px-4 border-b shrink-0 bg-card sticky top-0 z-10">
        {!collapsed && (
          <div className="flex items-center gap-2.5 font-bold text-lg text-primary tracking-tight">
            <img src="/logo.png" alt="Logo" className="w-7 h-7 object-contain rounded-md shrink-0" />
            <span>Khatavala</span>
          </div>
        )}
        {collapsed && (
          <img src="/logo.png" alt="Logo" className="w-7 h-7 object-contain mx-auto rounded-md" />
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-auto"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto p-3 space-y-6">
        {navSections.map((section) => {
          const visibleItems = section.items.filter(isItemVisible);
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.title}>
              {!collapsed && (
                <p className="px-3 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-2">
                  {section.title}
                </p>
              )}
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={linkClass}
                      title={item.label}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${item.iconColor || ''}`} />
                      {!collapsed && (
                        <span className="flex items-center justify-between w-full">
                          <span>{item.label}</span>
                          {item.badge && (
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${item.badge.className}`}
                            >
                              {item.badge.text}
                            </span>
                          )}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sidebar Footer */}
      {!collapsed && activeCompany && (
        <div className="p-3 border-t bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
          <div className="truncate">
            <span className="font-semibold block text-foreground truncate">{activeCompany.name}</span>
            <span className="text-[10px]">Active Company</span>
          </div>
        </div>
      )}
    </aside>
  );
}
