import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { FileUp, Link2, Users, Play, Pause, Square, RefreshCw, ShieldCheck, Activity, CheckCircle2, XCircle, Clock3, Loader2, UploadCloud, Settings2 } from 'lucide-react';
import { API, authFetch, TOKEN_KEY } from '@/utils/api';
import { cn } from '@/utils/cn';
import { useToast } from '@/components/ui/ToastProvider';

type LinkItem = { id: string; url: string; source_filename?: string; last_status?: string };
type Account = { id: string; name: string; phone_number?: string; status?: string; health_status?: string };
type Operation = { id: string; account_id: string; account_name: string; link_id: string; url: string; status: string; last_error?: string };
type Dashboard = { task: any; operations: Operation[]; stats: Record<string, number>; progress: number };

const statusMeta: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: 'انتظار', color: 'text-amber-400 bg-amber-500/10', icon: Clock3 },
  processing: { label: 'قيد التنفيذ', color: 'text-sky-400 bg-sky-500/10', icon: Loader2 },
  success: { label: 'نجاح', color: 'text-emerald-400 bg-emerald-500/10', icon: CheckCircle2 },
  failed: { label: 'فشل', color: 'text-rose-400 bg-rose-500/10', icon: XCircle },
  retry: { label: 'إعادة محاولة', color: 'text-orange-400 bg-orange-500/10', icon: RefreshCw },
  review: { label: 'مراجعة', color: 'text-violet-400 bg-violet-500/10', icon: ShieldCheck },
  skipped: { label: 'تخطي', color: 'text-slate-400 bg-slate-500/10', icon: Square },
};

function StatusBadge({ status }: { status: string }) {
  const meta = statusMeta[status] || statusMeta.pending; const Icon = meta.icon;
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold', meta.color)}><Icon className={cn('h-3.5 w-3.5', status === 'processing' && 'animate-spin')} />{meta.label}</span>;
}

export default function LinkImportView() {
  const { addToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filename, setFilename] = useState('');
  const [summary, setSummary] = useState<any>(null);
  const [minDelay, setMinDelay] = useState(60);
  const [maxDelay, setMaxDelay] = useState(180);
  const [maxRetries, setMaxRetries] = useState(2);
  const [taskId, setTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [linksRes, accountsRes] = await Promise.all([authFetch(`${API}/telegram/imported-links`), authFetch(`${API}/accounts`)]);
    const linksData = await linksRes.json(); const accountsData = await accountsRes.json();
    if (linksData.success) setLinks(linksData.links || []);
    if (accountsData.success) setAccounts(accountsData.accounts || []);
  }, []);
  const loadDashboard = useCallback(async (id: string) => { const r = await authFetch(`${API}/telegram/links/import-task/${id}`); const d = await r.json(); if (d.success) setDashboard(d); }, []);
  useEffect(() => { load().catch(() => addToast({ title: 'تعذر تحميل بيانات الاستيراد', type: 'error' })); }, [load, addToast]);
  useEffect(() => {
    const socket = io(window.location.origin, { path: '/socket.io', transports: ['websocket', 'polling'] }); socketRef.current = socket;
    socket.on('connect', () => { const user = JSON.parse(localStorage.getItem('wa_user') || '{}'); socket.emit('join_user', { userId: user.id, token: localStorage.getItem(TOKEN_KEY) || '' }); });
    const refresh = (event: any) => { if (event?.taskId && (!taskId || event.taskId === taskId)) { if (event.status === 'completed') addToast({ title: 'اكتملت مهمة استيراد الروابط', type: 'success' }); loadDashboard(event.taskId).catch(() => {}); } };
    socket.on('link_import:task_update', refresh); socket.on('link_import:operation_update', refresh);
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [addToast, loadDashboard, taskId]);
  useEffect(() => { if (!taskId) return; const id = window.setInterval(() => loadDashboard(taskId), 4000); return () => window.clearInterval(id); }, [taskId, loadDashboard]);

  async function importWord(file?: File) {
    if (!file) return; setImporting(true); setFilename(file.name); setSummary(null);
    try { const buffer = await file.arrayBuffer(); const bytes = new Uint8Array(buffer); let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); const contentBase64 = btoa(binary);
      const r = await authFetch(`${API}/telegram/links/import-word`, { method: 'POST', body: JSON.stringify({ filename: file.name, contentBase64 }) }); const d = await r.json(); if (!r.ok || !d.success) throw new Error(d.error || 'تعذر استيراد الملف'); setSummary(d.summary); await load(); addToast({ title: 'تم استيراد ملف Word بنجاح', type: 'success' });
    } catch (e: any) { addToast({ title: e.message || 'فشل الاستيراد', type: 'error' }); } finally { setImporting(false); }
  }
  async function startTask() {
    if (!selectedLinks.size || !selectedAccounts.size) return addToast({ title: 'اختر روابط وحسابات قبل البدء', type: 'error' });
    setBusy(true); try { const r = await authFetch(`${API}/telegram/links/import-task`, { method: 'POST', body: JSON.stringify({ linkIds: [...selectedLinks], accountIds: [...selectedAccounts], settings: { minDelaySeconds: minDelay, maxDelaySeconds: maxDelay, maxRetries } }) }); const d = await r.json(); if (!r.ok || !d.success) throw new Error(d.error || 'تعذر إنشاء المهمة'); setTaskId(d.taskId); await loadDashboard(d.taskId); addToast({ title: `تم إنشاء ${d.totalOperations} عملية مستقلة`, type: 'success' }); } catch (e: any) { addToast({ title: e.message, type: 'error' }); } finally { setBusy(false); }
  }
  async function control(status: 'paused' | 'pending' | 'stopped') { if (!taskId) return; await authFetch(`${API}/telegram/links/import-task/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadDashboard(taskId); }
  const matrix = useMemo(() => { const map = new Map<string, Operation>(); dashboard?.operations.forEach(op => map.set(`${op.account_id}:${op.link_id}`, op)); return map; }, [dashboard]);
  const selectedLinkItems = links.filter(l => selectedLinks.has(l.id));
  const connected = accounts.filter(a => a.status === 'connected' && a.health_status !== 'protected');
  const toggle = (setter: any, id: string) => setter((prev: Set<string>) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  return <div dir="rtl" className="space-y-6 pb-10">
    <header className="rounded-3xl border border-[var(--border-default)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-elevated)] p-6 shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-emerald-400"><Link2 className="h-5 w-5" /><span className="text-xs font-bold tracking-[0.18em]">قسم الروابط</span></div><h1 className="text-3xl font-black">استيراد الروابط</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">استورد روابط دعوات WhatsApp من ملف Word، راجعها، ثم أنشئ مهمة مستقلة لكل حساب × رابط مع حماية الحسابات وسجل تشغيل واضح.</p></div><button onClick={() => inputRef.current?.click()} disabled={importing} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:opacity-50">{importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}استيراد Word</button><input ref={inputRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={e => importWord(e.target.files?.[0])} /></div>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric icon={Link2} label="الروابط المتاحة" value={links.length} /><Metric icon={Users} label="الحسابات الجاهزة" value={connected.length} /><Metric icon={Activity} label="إجمالي العمليات" value={dashboard?.stats?.total || 0} /><Metric icon={CheckCircle2} label="نسبة الإنجاز" value={`${dashboard?.progress || 0}%`} /></div>
    </header>
    {summary && <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4"><div className="mb-3 flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5 text-emerald-400" />نتيجة الاستيراد · {summary.filename}</div><div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5"><Summary label="الإجمالي" value={summary.total} /><Summary label="جديد" value={summary.newLinks} tone="text-emerald-400" /><Summary label="مكرر" value={summary.duplicates} tone="text-amber-400" /><Summary label="غير صالح" value={summary.invalid} tone="text-rose-400" /><Summary label="الحالة" value="مكتمل" tone="text-emerald-400" /></div></div>}
    <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
      <section className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="flex items-center gap-2 text-lg font-bold"><Link2 className="h-5 w-5 text-emerald-400" />الروابط المستوردة</h2><p className="mt-1 text-xs text-[var(--text-muted)]">حدد الروابط التي ستدخل في المهمة الجديدة.</p></div><button onClick={() => setSelectedLinks(new Set(links.map(l => l.id)))} className="text-xs text-emerald-400 hover:underline">تحديد الكل</button></div><div className="max-h-80 space-y-2 overflow-auto">{links.length ? links.map(link => <label key={link.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 hover:border-emerald-500/40"><input type="checkbox" checked={selectedLinks.has(link.id)} onChange={() => toggle(setSelectedLinks, link.id)} className="h-4 w-4 accent-emerald-500" /><span className="min-w-0 flex-1 truncate text-sm" dir="ltr">{link.url}</span>{link.last_status && <StatusBadge status={link.last_status} />}</label>) : <Empty icon={UploadCloud} text="لم تستورد روابط بعد. ابدأ باختيار ملف Word." />}</div></section>
      <section className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="flex items-center gap-2 text-lg font-bold"><Users className="h-5 w-5 text-sky-400" />اختيار الحسابات</h2><p className="mt-1 text-xs text-[var(--text-muted)]">لا تُرسل عمليات للحسابات غير المتصلة أو المحمية.</p></div><button onClick={() => setSelectedAccounts(new Set(connected.map(a => a.id)))} className="text-xs text-sky-400 hover:underline">تحديد الجاهز</button></div><div className="space-y-2">{accounts.length ? accounts.map(account => <label key={account.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3"><input type="checkbox" checked={selectedAccounts.has(account.id)} onChange={() => toggle(setSelectedAccounts, account.id)} disabled={account.status !== 'connected' || account.health_status === 'protected'} className="h-4 w-4 accent-sky-500" /><span className="flex-1"><span className="block text-sm font-semibold">{account.name}</span><span className="text-xs text-[var(--text-muted)]">{account.phone_number || 'بدون رقم'}</span></span><StatusBadge status={account.health_status === 'protected' ? 'review' : account.status === 'connected' ? 'success' : 'skipped'} /></label>) : <Empty icon={Users} text="لا توجد حسابات متاحة." />}</div></section>
    </div>
    <section className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5"><div className="mb-4 flex items-center gap-2"><Settings2 className="h-5 w-5 text-violet-400" /><h2 className="text-lg font-bold">إعدادات التشغيل الآمن</h2></div><div className="grid gap-4 md:grid-cols-3"><Field label="الحد الأدنى للتأخير (ثانية)" value={minDelay} setValue={setMinDelay} /><Field label="الحد الأعلى للتأخير (ثانية)" value={maxDelay} setValue={setMaxDelay} /><Field label="الحد الأقصى للمحاولات" value={maxRetries} setValue={setMaxRetries} /></div><div className="mt-4 flex flex-wrap items-center gap-3"><button onClick={startTask} disabled={busy || !selectedLinks.size || !selectedAccounts.size} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}بدء الانضمام الآمن</button>{taskId && <><button onClick={() => control('paused')} className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 px-4 py-3 text-sm font-semibold text-amber-400"><Pause className="h-4 w-4" />إيقاف مؤقت</button><button onClick={() => control('stopped')} className="inline-flex items-center gap-2 rounded-xl border border-rose-500/30 px-4 py-3 text-sm font-semibold text-rose-400"><Square className="h-4 w-4" />إيقاف المهمة</button><button onClick={() => control('pending')} className="inline-flex items-center gap-2 rounded-xl border border-sky-500/30 px-4 py-3 text-sm font-semibold text-sky-400"><RefreshCw className="h-4 w-4" />استئناف</button></>}</div></section>
    {dashboard && <section className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><Activity className="h-5 w-5 text-violet-400" />مصفوفة الحساب × الرابط</h2><p className="mt-1 text-xs text-[var(--text-muted)]">تتحدث الحالات من الخادم دون الحاجة إلى تحديث الصفحة.</p></div><div className="text-sm font-bold text-emerald-400">{dashboard.progress}% مكتمل</div></div><div className="mb-5 h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]"><div className="h-full rounded-full bg-gradient-to-l from-emerald-400 to-sky-400 transition-all" style={{ width: `${dashboard.progress}%` }} /></div><div className="overflow-auto"><table className="w-full min-w-[720px] text-right text-sm"><thead><tr className="border-b border-[var(--border-default)] text-xs text-[var(--text-muted)]"><th className="p-3">الحساب</th>{selectedLinkItems.map(l => <th key={l.id} className="max-w-32 p-3" dir="ltr">{l.url.split('/').pop()}</th>)}</tr></thead><tbody>{accounts.filter(a => selectedAccounts.has(a.id)).map(a => <tr key={a.id} className="border-b border-[var(--border-default)]"><td className="p-3 font-semibold">{a.name}</td>{selectedLinkItems.map(l => { const op = matrix.get(`${a.id}:${l.id}`); return <td key={l.id} className="p-3"><StatusBadge status={op?.status || 'pending'} /></td> })}</tr>)}</tbody></table></div></section>}
  </div>;
}
function Metric({ icon: Icon, label, value }: any) { return <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"><Icon className="mb-3 h-5 w-5 text-emerald-400" /><div className="text-2xl font-black">{value}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{label}</div></div>; }
function Summary({ label, value, tone = '' }: any) { return <div><div className="text-xs text-[var(--text-muted)]">{label}</div><div className={cn('mt-1 text-lg font-bold', tone)}>{value}</div></div>; }
function Field({ label, value, setValue }: any) { return <label className="text-sm"><span className="mb-2 block text-xs text-[var(--text-muted)]">{label}</span><input type="number" min="0" value={value} onChange={e => setValue(Number(e.target.value))} className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5" /></label>; }
function Empty({ icon: Icon, text }: any) { return <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-[var(--text-muted)]"><Icon className="h-8 w-8 opacity-40" /><span>{text}</span></div>; }
