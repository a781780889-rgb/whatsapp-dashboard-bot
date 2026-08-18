import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Database, History, PauseCircle, PlayCircle, RefreshCw, Radio, Server, Settings2, ShieldCheck, StopCircle, Wifi, WifiOff, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/utils/cn';

interface MonitorStats {
  total: number;
  new: number;
  joined: number;
  failed: number;
  duplicates: number;
  joinedToday: number;
  failedToday: number;
  retryPending?: number;
  invalidLink?: number;
  joining?: number;
  lastDiscovered: string | null;
  newToday?: number;
  newHour?: number;
  health?: { database?: string; monitoringEngine?: string };
}

interface MonitorJob {
  id?: string | null;
  status?: string;
  progress?: number;
  total?: number;
  scanned?: number;
  found?: number;
  duplicates?: number;
  invalid?: number;
  review?: number;
  retries?: number;
  maxRetries?: number;
  currentChat?: string | null;
  lastError?: string | null;
  log?: { ts: string; msg: string }[];
}

interface MonitorAccount {
  id: string;
  name?: string;
  phone_number?: string;
  status?: string;
  connected?: boolean;
}

interface Props {
  stats: MonitorStats | null;
  job: MonitorJob | null;
  accounts: MonitorAccount[];
  realtime: 'connected' | 'reconnecting' | 'offline';
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onSync: () => void;
  onOpenLog: () => void;
}

const statusText: Record<string, string> = {
  running: 'يعمل', processing: 'يعالج', queued: 'في الطابور', waiting: 'ينتظر', retrying: 'إعادة محاولة', paused: 'متوقف مؤقتاً', finished: 'مكتمل', stopped: 'متوقف', error: 'خطأ', idle: 'خامل',
};

const isBusy = (status?: string) => ['running', 'processing', 'queued', 'waiting', 'retrying'].includes(status || '');

export default function LinkMonitoringCenter({ stats, job, accounts, realtime, onStart, onStop, onPause, onResume, onRetry, onSync, onOpenLog }: Props) {
  const jobBusy = isBusy(job?.status);
  const jobPaused = job?.status === 'paused';
  const jobError = job?.status === 'error';
  const connectedSources = accounts.filter(account => account.connected !== false && ['connected', 'ready', 'idle', 'running'].includes(account.status || 'connected')).length;
  const activeSources = accounts.filter(account => account.connected !== false).length;
  const statusLabel = job ? (statusText[job.status || ''] || job.status || 'غير معروف') : 'خامل';
  const health = [
    { label: 'قاعدة البيانات', value: stats?.health?.database === 'healthy' ? 'سليمة' : 'غير متاحة', tone: stats?.health?.database === 'healthy' ? 'good' : 'warn', Icon: Database },
    { label: 'WebSocket', value: realtime === 'connected' ? 'متصل' : realtime === 'reconnecting' ? 'إعادة اتصال' : 'غير متصل', tone: realtime === 'connected' ? 'good' : 'warn', Icon: realtime === 'connected' ? Wifi : WifiOff },
    { label: 'محرك المراقبة', value: jobBusy ? 'يعمل' : jobPaused ? 'متوقف مؤقتاً' : stats?.health?.monitoringEngine === 'idle' ? 'خامل' : 'غير متاح', tone: jobBusy ? 'good' : jobPaused ? 'warn' : 'neutral', Icon: Activity },
    { label: 'المصادر المتصلة', value: `${connectedSources}/${activeSources}`, tone: connectedSources > 0 ? 'good' : 'warn', Icon: Radio },
  ];

  const metricCards = [
    { label: 'إجمالي الروابط', value: stats?.total ?? '—', helper: `اليوم: ${stats?.newToday ?? '—'} · الساعة: ${stats?.newHour ?? '—'}`, color: 'text-cyan-300', Icon: Zap },
    { label: 'روابط جديدة', value: stats?.new ?? '—', helper: `منضم اليوم: ${stats?.joinedToday ?? '—'}`, color: 'text-emerald-300', Icon: CheckCircle2 },
    { label: 'روابط مكررة', value: stats?.duplicates ?? '—', helper: 'تم احتسابها من قاعدة البيانات', color: 'text-amber-300', Icon: RefreshCw },
    { label: 'روابط غير صالحة', value: stats?.invalidLink ?? '—', helper: `فشل اليوم: ${stats?.failedToday ?? '—'}`, color: 'text-rose-300', Icon: AlertTriangle },
    { label: 'قيد التحقق', value: stats?.joining ?? '—', helper: `إعادة محاولة: ${stats?.retryPending ?? '—'}`, color: 'text-violet-300', Icon: Activity },
    { label: 'المصادر النشطة', value: connectedSources, helper: `الإجمالي: ${activeSources}`, color: 'text-sky-300', Icon: Radio },
  ];

  return (
    <section className="space-y-4 flex-shrink-0" aria-label="مركز مراقبة الروابط">
      <Card className="border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-[var(--bg-card)] to-[var(--bg-card)]">
        <CardContent className="p-4 md:p-5">
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="rounded-xl bg-cyan-500/15 p-2 text-cyan-300"><Radio className="w-5 h-5" /></div>
                <div><h2 className="text-lg font-bold text-[var(--text-primary)]">مركز مراقبة الروابط</h2><p className="text-xs text-[var(--text-secondary)] mt-1">نظام مراقبة وتحليل لحظي مبني على البيانات القادمة من الخادم وقاعدة البيانات.</p></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <Badge className={cn(realtime === 'connected' ? 'text-emerald-300' : realtime === 'reconnecting' ? 'text-amber-300' : 'text-rose-300')}><span className="ml-1">●</span>{realtime === 'connected' ? 'متصل لحظياً' : realtime === 'reconnecting' ? 'إعادة الاتصال' : 'غير متصل'}</Badge>
                <span className="text-[var(--text-muted)]">آخر اكتشاف: {stats?.lastDiscovered ? new Date(stats.lastDiscovered).toLocaleString('ar-SA') : 'لا توجد بيانات'}</span>
                {job?.id && <span className="text-[var(--text-muted)]">Job: <b className="font-mono">{job.id}</b></span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!jobBusy && !jobPaused && !jobError && <Button size="sm" onClick={onStart} className="gap-1.5 bg-blue-600 hover:bg-blue-700"><PlayCircle className="w-4 h-4" />بدء المراقبة</Button>}
              {jobBusy && <Button size="sm" variant="outline" onClick={onPause} className="gap-1.5 border-amber-500/40 text-amber-300"><PauseCircle className="w-4 h-4" />إيقاف مؤقت</Button>}
              {jobPaused && <Button size="sm" variant="outline" onClick={onResume} className="gap-1.5 border-blue-500/40 text-blue-300"><PlayCircle className="w-4 h-4" />استئناف</Button>}
              {jobError && <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5 border-amber-500/40 text-amber-300"><RefreshCw className="w-4 h-4" />إعادة المحاولة</Button>}
              {(jobBusy || jobPaused) && <Button size="sm" variant="outline" onClick={onStop} className="gap-1.5 border-rose-500/40 text-rose-300"><StopCircle className="w-4 h-4" />إيقاف آمن</Button>}
              <Button size="sm" variant="outline" onClick={onSync} className="gap-1.5"><RefreshCw className="w-4 h-4" />مزامنة الآن</Button>
              <Button size="sm" variant="outline" onClick={onOpenLog} className="gap-1.5"><History className="w-4 h-4" />السجل</Button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            {metricCards.map(({ label, value, helper, color, Icon }) => <div key={label} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)]/60 p-3"><div className="flex items-center justify-between text-xs text-[var(--text-muted)]"><span>{label}</span><Icon className="w-4 h-4" /></div><div className={cn('mt-2 text-xl font-extrabold', color)}>{value}</div><div className="mt-1 text-[0.65rem] text-[var(--text-muted)] truncate">{helper}</div></div>)}
          </div>
        </CardContent>
      </Card>

      <div className="grid xl:grid-cols-[1.2fr_1fr] gap-4">
        <Card className="border-[var(--border-default)]"><CardContent className="p-4"><div className="flex items-center justify-between mb-3"><div><h3 className="font-bold">صحة النظام</h3><p className="text-xs text-[var(--text-muted)] mt-1">تعكس الحالات المتاحة فعلياً من الواجهة والخادم.</p></div><ShieldCheck className="w-5 h-5 text-emerald-300" /></div><div className="grid grid-cols-2 md:grid-cols-4 gap-2">{health.map(({ label, value, tone, Icon }) => <div key={label} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)]/50 p-3"><Icon className={cn('w-4 h-4 mb-2', tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-[var(--text-muted)]')} /><div className="text-xs text-[var(--text-muted)]">{label}</div><div className={cn('mt-1 text-xs font-semibold', tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-[var(--text-secondary)]')}>{value}</div></div>)}</div></CardContent></Card>
        <Card className="border-[var(--border-default)]"><CardContent className="p-4"><div className="flex items-center justify-between mb-3"><div><h3 className="font-bold">حالة المهمة الحالية</h3><p className="text-xs text-[var(--text-muted)] mt-1">المؤشر الحقيقي القادم من محرك الفحص.</p></div><Server className="w-5 h-5 text-cyan-300" /></div>{job ? <><div className="flex items-center justify-between text-sm"><span className="text-[var(--text-secondary)]">الحالة</span><b className={cn(jobError ? 'text-rose-300' : jobPaused ? 'text-amber-300' : jobBusy ? 'text-cyan-300' : 'text-emerald-300')}>{statusLabel}</b></div><div className="mt-3 flex items-center justify-between text-xs text-[var(--text-muted)]"><span>التقدم</span><b>{Math.round(job.progress || 0)}% · {job.scanned || 0}/{job.total || 0}</b></div><Progress value={job.progress || 0} className="mt-2 h-2" />{job.currentChat && <div className="mt-3 truncate rounded-lg bg-[var(--bg-elevated)] p-2 text-xs text-cyan-200">المصدر الحالي: {job.currentChat}</div>}{job.lastError && <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-200">{job.lastError}</div>}</> : <div className="rounded-xl border border-dashed border-[var(--border-default)] p-5 text-center text-sm text-[var(--text-muted)]">لا توجد مهمة مراقبة نشطة.</div>}</CardContent></Card>
      </div>

      <Card className="border-[var(--border-default)]"><CardContent className="p-4"><div className="flex items-center justify-between mb-3"><div><h3 className="font-bold">مصادر المراقبة</h3><p className="text-xs text-[var(--text-muted)] mt-1">حالة الحسابات الفعلية المتاحة للمراقبة.</p></div><Radio className="w-5 h-5 text-sky-300" /></div><div className="grid md:grid-cols-2 xl:grid-cols-4 gap-2">{accounts.length ? accounts.map(account => { const connected = account.connected !== false; const active = connected && ['connected', 'ready', 'idle', 'running'].includes(account.status || 'connected'); return <div key={account.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)]/50 p-3"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><b className="block truncate text-sm">{account.name || account.phone_number || account.id}</b><span className="text-[0.7rem] text-[var(--text-muted)]">{account.phone_number || account.id}</span></div><span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', active ? 'bg-emerald-400' : connected ? 'bg-amber-400' : 'bg-rose-400')} /></div><div className="mt-3 flex items-center justify-between text-xs"><span className={active ? 'text-emerald-300' : connected ? 'text-amber-300' : 'text-rose-300'}>{active ? 'متصل ونشط' : connected ? 'متصل بتحذير' : 'غير متصل'}</span><span className="text-[var(--text-muted)]">{statusText[account.status || ''] || account.status || 'غير معروف'}</span></div></div>; }) : <div className="md:col-span-2 xl:col-span-4 rounded-xl border border-dashed border-[var(--border-default)] p-5 text-center text-sm text-[var(--text-muted)]">لا توجد مصادر متاحة من الخادم.</div>}</div></CardContent></Card>
    </section>
  );
}
