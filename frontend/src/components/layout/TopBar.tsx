import React, { useEffect, useState, useRef } from 'react';
import { Search, Bell, Sun, Moon, ChevronDown, Check, CheckCheck } from 'lucide-react';
import { cn } from '@/utils/cn';

interface NotificationItem {
  id: string;
  title: string;
  description: string;
  time: string;
  read: boolean;
}

interface TopBarProps {
  accounts: any[];
  selectedAccountId: string | null;
  onAccountChange: (id: string | null) => void;
  currentUser: any;
}

const seedNotifications: NotificationItem[] = [
  { id: '1', title: 'تم تفعيل حساب جديد', description: 'حساب "خدمة العملاء" متصل الآن', time: 'منذ 5 دقائق', read: false },
  { id: '2', title: 'انتهت حملة "عروض الصيف"', description: '1,204 رسالة تم إرسالها بنجاح', time: 'منذ ساعة', read: false },
  { id: '3', title: 'تحذير: اقتراب انتهاء الاشتراك', description: 'يتبقى 3 أيام على انتهاء الباقة الحالية', time: 'أمس', read: true },
];

export function TopBar({ accounts, selectedAccountId, onAccountChange, currentUser }: TopBarProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [showAccounts, setShowAccounts] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState(seedNotifications);
  const accountsRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (accountsRef.current && !accountsRef.current.contains(e.target as Node)) setShowAccounts(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const unreadCount = notifications.filter(n => !n.read).length;

  function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  function openCommandPalette() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  }

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-[var(--border-default)] glass sticky top-0 z-[var(--z-sticky)]">

      {/* Search / Command Palette trigger */}
      <div className="flex-1 flex items-center">
        <button
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-all w-64 text-sm"
          onClick={openCommandPalette}
        >
          <Search className="w-4 h-4" />
          <span>بحث سريع...</span>
          <div className="mr-auto flex gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-app)] text-[10px] font-mono border border-[var(--border-strong)]">Ctrl</kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-app)] text-[10px] font-mono border border-[var(--border-strong)]">K</kbd>
          </div>
        </button>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-4">

        {/* Account Selector */}
        <div className="relative" ref={accountsRef}>
          <button
            onClick={() => setShowAccounts(!showAccounts)}
            aria-haspopup="listbox"
            aria-expanded={showAccounts}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] transition-colors text-sm font-medium min-w-[160px]"
          >
            <div className={cn("w-2 h-2 rounded-full", selectedAccount?.status === 'connected' ? "bg-[var(--success)] shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-[var(--danger)]")} />
            <span className="truncate flex-1 text-right">{selectedAccount?.name || 'اختر حساباً'}</span>
            <ChevronDown className={cn("w-4 h-4 text-[var(--text-muted)] transition-transform", showAccounts && "rotate-180")} />
          </button>

          {showAccounts && (
            <div className="absolute top-full mt-2 left-0 w-full min-w-[220px] bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl shadow-elevated overflow-hidden z-[var(--z-dropdown)] animate-scale-in origin-top-left">
              <div className="max-h-64 overflow-y-auto p-1.5">
                {accounts.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">لا توجد حسابات</div>
                ) : (
                  accounts.map(acc => (
                    <button
                      key={acc.id}
                      onClick={() => { onAccountChange(acc.id); setShowAccounts(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-sm text-right"
                    >
                      <div className={cn("w-2 h-2 rounded-full", acc.status === 'connected' ? "bg-[var(--success)]" : "bg-[var(--danger)]")} />
                      <span className="flex-1 truncate">{acc.name}</span>
                      {selectedAccountId === acc.id && <Check className="w-4 h-4 text-[var(--brand-primary)]" />}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-[var(--border-default)]" />

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title="تبديل المظهر"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors relative"
            aria-label="الإشعارات"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 flex items-center justify-center bg-[var(--danger)] text-white text-[9px] font-bold rounded-full border border-[var(--bg-surface)]">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute top-full mt-2 left-0 w-80 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl shadow-elevated overflow-hidden z-[var(--z-dropdown)] animate-scale-in origin-top-left">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
                <h4 className="text-sm font-bold text-primary">الإشعارات</h4>
                <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-[var(--brand-primary)] hover:underline">
                  <CheckCheck className="w-3.5 h-3.5" /> تعليم الكل كمقروء
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.map(n => (
                  <div key={n.id} className={cn("flex gap-3 px-4 py-3 border-b border-[var(--border-default)] last:border-0", !n.read && "bg-[var(--brand-primary-light)]")}>
                    <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", n.read ? "bg-transparent" : "bg-[var(--brand-primary)]")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">{n.title}</p>
                      <p className="text-xs text-secondary mt-0.5">{n.description}</p>
                      <p className="text-[11px] text-muted mt-1">{n.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
