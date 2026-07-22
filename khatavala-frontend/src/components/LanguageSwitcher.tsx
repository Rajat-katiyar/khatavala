import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check } from 'lucide-react';
import { SUPPORTED_LANGUAGES, type LanguageCode } from '@/i18n/i18n';
import { Button } from '@/components/ui/button';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentLang =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0];

  const handleChange = (code: LanguageCode) => {
    void i18n.changeLanguage(code);
    localStorage.setItem('khatavala-lang', code);
    setOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs h-8 px-2 font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch language"
      >
        <Globe className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{currentLang.nativeLabel}</span>
      </Button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-44 rounded-lg border bg-card shadow-lg py-1 text-sm">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleChange(lang.code)}
              className={`w-full flex items-center justify-between px-3 py-2 hover:bg-muted transition-colors text-left ${
                i18n.language === lang.code ? 'text-primary font-semibold' : 'text-foreground'
              }`}
            >
              <span>{lang.nativeLabel}</span>
              <span className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{lang.label}</span>
                {i18n.language === lang.code && <Check className="w-3 h-3 text-primary" />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
