"use client";

import { useCallback, useEffect, useState } from "react";
import type { Enquiry, EnquiryStatus } from "@/lib/enquiries/schema";
import { ENQUIRY_STATUSES } from "@/lib/enquiries/schema";
import ProductsAdmin from "./ProductsAdmin";

type Session = { enabled: boolean; reason?: string; signedIn: boolean; storage?: { kind: string; description: string } };

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), { status: res.status, body });
  return body;
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<"enquiries" | "products">("enquiries");
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api<Session>("/api/admin/session").then(setSession, (e: Error) => setLoadError(e.message));
  }, []);
  useEffect(refresh, [refresh]);

  const signOut = async () => {
    await api("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
    refresh();
  };

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:px-6">
        <div>
          <p className="font-display text-xl leading-tight">Target Kitchen Studio</p>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Admin</p>
        </div>
        <a href="/" className="ml-auto text-sm text-accent hover:underline">
          Open the studio
        </a>
        {session?.signedIn && (
          <button type="button" onClick={signOut} className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-canvas" data-testid="admin-signout">
            Sign out
          </button>
        )}
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
        {loadError && <p className="rounded-lg bg-warn-soft p-3 text-warn">{loadError}</p>}
        {!session && !loadError && <p className="text-muted">Loading…</p>}
        {session && !session.enabled && (
          <div className="max-w-xl rounded-2xl border border-line bg-surface p-6" data-testid="admin-disabled">
            <h1 className="font-display text-2xl">Admin is switched off</h1>
            <p className="mt-2 text-sm text-muted">{session.reason}</p>
            <p className="mt-3 text-sm">
              To switch it on, set <code className="rounded bg-canvas px-1">ADMIN_PASSWORD</code> (at least 12 characters) in the server&apos;s environment settings and restart. The password is checked on the server only.
            </p>
          </div>
        )}
        {session?.enabled && !session.signedIn && <Login onDone={refresh} />}
        {session?.signedIn && (
          <>
            <nav className="mb-5 flex gap-2" aria-label="Admin sections">
              {(["enquiries", "products"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} aria-current={tab === t} className={`rounded-full px-4 py-2 text-sm font-medium ${tab === t ? "bg-ink text-white" : "border border-line bg-surface hover:bg-canvas"}`} data-testid={`admin-tab-${t}`}>
                  {t === "enquiries" ? "Quote enquiries" : "Products and import"}
                </button>
              ))}
            </nav>
            {tab === "enquiries" ? <EnquiriesAdmin onSignedOut={refresh} /> : <ProductsAdmin onSignedOut={refresh} />}
            <p className="mt-10 text-xs text-muted">
              Sign-in uses one shared password checked on the server, with an 8-hour session cookie. There are no individual staff accounts, password reset or two-factor sign-in yet. Always use the site over HTTPS.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="max-w-sm rounded-2xl border border-line bg-surface p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api("/api/admin/session", { method: "POST", body: JSON.stringify({ password }) });
          setPassword("");
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
      data-testid="admin-login"
    >
      <h1 className="font-display text-2xl">Sign in</h1>
      <label htmlFor="admin-password" className="mt-4 block text-sm font-medium">
        Admin password
      </label>
      <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2" data-testid="admin-password" />
      {error && (
        <p className="mt-2 text-sm text-warn" role="alert" data-testid="admin-login-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !password} className="mt-4 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50" data-testid="admin-signin">
        {busy ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}

const STATUS_LABEL: Record<EnquiryStatus, string> = { new: "New", contacted: "Contacted", quoted: "Quote sent", closed: "Closed" };
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function EnquiriesAdmin({ onSignedOut }: { onSignedOut: () => void }) {
  const [list, setList] = useState<Enquiry[] | null>(null);
  const [storage, setStorage] = useState<{ kind: string; description: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"" | EnquiryStatus>("");
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<{ enquiries: Enquiry[]; storage: { kind: string; description: string } }>("/api/admin/enquiries").then(
      (r) => {
        setList(r.enquiries);
        setStorage(r.storage);
      },
      (e: Error & { status?: number }) => (e.status === 401 ? onSignedOut() : setError(e.message)),
    );
  }, [onSignedOut]);
  useEffect(load, [load]);

  const update = async (id: string, patch: { status?: EnquiryStatus; adminNote?: string }) => {
    setSaving(id);
    setError(null);
    try {
      const r = await api<{ enquiry: Enquiry }>(`/api/admin/enquiries/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setList((l) => l?.map((e) => (e.id === id ? r.enquiry : e)) ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const shown = list?.filter((e) => !filter || e.status === filter) ?? [];
  const counts = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s, list?.filter((e) => e.status === s).length ?? 0]));

  return (
    <section aria-label="Quote enquiries" data-testid="admin-enquiries">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl">Quote enquiries</h1>
        <span className="text-sm text-muted">{list ? `${list.length} total · ${counts.new} new` : ""}</span>
        <div className="ml-auto flex items-center gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value as EnquiryStatus | "")} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm" aria-label="Filter by status">
            <option value="">All statuses</option>
            {ENQUIRY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]} ({counts[s]})
              </option>
            ))}
          </select>
          <button type="button" onClick={load} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:bg-canvas">
            Refresh
          </button>
          <a href="/api/admin/enquiries/export" className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:bg-canvas" data-testid="export-enquiries">
            Export CSV
          </a>
        </div>
      </div>
      {storage && (
        <p className="mb-3 text-xs text-muted" data-testid="storage-info">
          Stored in: {storage.description}.{" "}
          {storage.kind === "file" && "This works on a normal server with its own disk. On serverless hosting (Vercel, Netlify) connect Supabase instead, or enquiries cannot be saved."}
          {" "}No email is sent when an enquiry arrives; check this page.
        </p>
      )}
      {error && (
        <p className="mb-3 rounded-lg bg-warn-soft p-3 text-sm text-warn" role="alert">
          {error}
        </p>
      )}
      {list && !list.length && <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">No enquiries yet.</p>}
      {!!shown.length && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">Panels</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((e) => (
                <EnquiryRow key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} onUpdate={(p) => update(e.id, p)} saving={saving === e.id} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EnquiryRow({ e, open, onToggle, onUpdate, saving }: { e: Enquiry; open: boolean; onToggle: () => void; onUpdate: (p: { status?: EnquiryStatus; adminNote?: string }) => void; saving: boolean }) {
  const [note, setNote] = useState(e.adminNote ?? "");
  return (
    <>
      <tr className="align-top" data-testid={`enquiry-${e.reference}`}>
        <td className="px-3 py-2">
          <button type="button" onClick={onToggle} className="font-mono text-[13px] text-accent hover:underline" aria-expanded={open}>
            {e.reference}
          </button>
          {e.containsDemoPanels && <span className="ml-1 rounded bg-warn-soft px-1 text-[11px] text-warn">DEMO panels</span>}
        </td>
        <td className="whitespace-nowrap px-3 py-2">{fmt(e.createdAt)}</td>
        <td className="px-3 py-2">
          {e.contact.name}
          {e.contact.company && <span className="block text-xs text-muted">{e.contact.company}</span>}
        </td>
        <td className="px-3 py-2">
          {e.contact.phone && <span className="block">{e.contact.phone}</span>}
          {e.contact.email && <span className="block break-all">{e.contact.email}</span>}
          {e.contact.preferredContact && <span className="block text-xs text-muted">prefers {e.contact.preferredContact}</span>}
        </td>
        <td className="px-3 py-2">{e.design.items.length}</td>
        <td className="px-3 py-2">
          <select value={e.status} disabled={saving} onChange={(ev) => onUpdate({ status: ev.target.value as EnquiryStatus })} className="rounded-lg border border-line bg-surface px-2 py-1" aria-label={`Status of ${e.reference}`} data-testid="enquiry-status">
            {ENQUIRY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-canvas/60 px-3 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="font-medium">
                  {e.design.designName ?? "Unsaved design"}
                  {e.design.variantName && ` · ${e.design.variantName}`} · {e.design.modelName}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {e.design.items.map((i) => (
                    <li key={i.region}>
                      {i.regionLabel}: <span className="font-mono text-[13px]">{i.panelCode}</span> {i.productName}
                      <span className="text-muted">{[i.brand, i.board, i.finish].filter(Boolean).length ? ` · ${[i.brand, i.board, i.finish].filter(Boolean).join(" · ")}` : ""}</span>
                    </li>
                  ))}
                </ul>
                {e.design.shareToken && (
                  <a href={`/?design=${e.design.shareToken}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-accent hover:underline">
                    Open this design in the studio
                  </a>
                )}
                {e.contact.location && <p className="mt-2 text-sm">Area: {e.contact.location}</p>}
                {e.message && <p className="mt-2 whitespace-pre-wrap text-sm">“{e.message}”</p>}
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor={`note-${e.id}`}>
                  Internal note
                </label>
                <textarea id={`note-${e.id}`} rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={2000} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
                <button type="button" disabled={saving || note === (e.adminNote ?? "")} onClick={() => onUpdate({ adminNote: note })} className="mt-1 rounded-full bg-ink px-3 py-1.5 text-sm text-white disabled:opacity-40">
                  Save note
                </button>
                <p className="mt-1 text-xs text-muted">Last updated {fmt(e.updatedAt)}</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
