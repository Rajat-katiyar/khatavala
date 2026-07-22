import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CompanySwitcher } from '@/components/CompanySwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Sidebar } from '@/components/Sidebar';
import { OfflineSyncStatus } from '@/components/OfflineSyncStatus';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { GlobalSearchModal } from '@/components/GlobalSearchModal';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';
import * as authService from '@/services/auth.service';

export function Layout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const roleName = useCompanyStore((s) => s.activeRole);
  const isSwitching = useCompanyStore((s) => s.isSwitching);

  const [searchOpen, setSearchOpen] = useState(false);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // CTRL + SHIFT + K -> Universal Elastic Omnisearch
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      // CTRL + SHIFT + B -> Direct Normal Billing (POS) Page
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        navigate('/pos');
      }
      // CTRL + SHIFT + C -> Customer Search Page
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        navigate('/customers');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const handleLogout = async () => {
    await authService.logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {/* Universal Omnisearch Modal */}
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Left Sidebar (Fixed on Left) */}
      <Sidebar />

      {/* Main Column Layout (Fixed Top Header + Scrollable Page Content) */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Header Navbar (Fixed on Top) */}
        <header className="h-14 border-b bg-card px-6 flex items-center justify-between gap-4 sticky top-0 z-30 shrink-0 shadow-sm border-border">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-muted-foreground hidden sm:inline">
              Hisaab Ka Naya Tareeka
            </span>
            <OfflineSyncStatus />

            {/* Elastic Search Bar Trigger */}
            <span
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-muted/40 hover:bg-muted text-xs text-muted-foreground transition-all hover:border-primary/40 shadow-xs min-w-[200px]"
              title="Universal Elastic Search (CTRL+SHIFT+K)"
            >
              <Search className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="hidden md:inline font-medium text-foreground">Searching...</span>
              <kbd ></kbd>
            </span >

            {/* Shortcut Badges */}
            <div className="hidden xl:flex items-center gap-2 border-l pl-3 text-xs text-muted-foreground">
              <span
                onClick={() => navigate('/pos')}
                className="flex items-center gap-1.5 px-2 py-1 rounded "
                title="Direct Normal Billing (CTRL+SHIFT+B)"
              >
              </span>
              <span
                onClick={() => navigate('/customers')}
                className="flex items-center gap-1.5 px-2 py-1 rounded "
                title="Customer Search (CTRL+SHIFT+C)"
              >
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            {/* Language Switcher */}
            <LanguageSwitcher />
            <ThemeToggle />
            <CompanySwitcher />
            {user && (
              <div className="flex items-center gap-2 pl-2 border-l">
                <span className="hidden md:inline font-medium text-foreground text-sm">
                  {user.fullName}
                </span>
                {roleName && (
                  <Badge variant="muted" className="hidden lg:inline-flex">
                    {roleName}
                  </Badge>
                )}
                <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs">
                  {t('common.logout')}
                </Button>
              </div>
            )}
          </div>
        </header>

        {isSwitching && (
          <div className="border-b bg-muted/40 px-4 py-1.5 text-center text-xs text-muted-foreground shrink-0">
            Switching company...
          </div>
        )}

        {/* Page Content Viewport (Scrollable underneath fixed header) */}
        <main className="flex-1 p-6 overflow-y-auto min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
