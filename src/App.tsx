// Batch ID Pro — Single-File App (V1.1 — CONFIRM + LOCK + QR RECEIPT CONFIRM + LOGOUT + SUPABASE)
// QR codes point to resolver at https://batch.coresystemsni.com/?receipt=ID&d=ENCODED
// No router. Vite + React. TypeScript-safe.

import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createClient, type Session } from "@supabase/supabase-js";

/* ---------- localStorage helpers (BUILD-SAFE) ---------- */
function lsGet(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function lsSet(key: string, val: string): void {
  try {
    window.localStorage.setItem(key, val);
  } catch {
    // ignore
  }
}
function lsDel(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
function lsJson<T>(key: string, fallback: T): T {
  try {
    const raw = lsGet(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
/* ------------------------------------------------------ */

// ─── RESOLVER URL ────────────────────────────────────────────────────────────
const RESOLVER_BASE = "https://batch.coresystemsni.com";

// ─── BRANDING ────────────────────────────────────────────────────────────────
const LOGO_URL =
  "https://res.cloudinary.com/dmnuqcykq/image/upload/v1770027904/ChatGPT_Image_Feb_2_2026_10_24_54_AM_f99qva.png";
const APP_NAME = "Batch ID Pro";

// ─── SUPABASE (CONFIGURED) — HARDENED ENV VAR EXTRACTION ──────────────────────
function getEnvVar(key: string): string | undefined {
  try {
    const val = (import.meta as any).env?.[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isValidHttpUrl(str: string | undefined): str is string {
  if (!str || typeof str !== 'string') return false;
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const SUPABASE_URL = getEnvVar('VITE_SUPABASE_URL');
const SUPABASE_ANON = getEnvVar('VITE_SUPABASE_ANON_KEY');

const supabase =
  isValidHttpUrl(SUPABASE_URL) && SUPABASE_ANON && SUPABASE_ANON.length > 20
    ? createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true } })
    : null;

// ─── TYPES ───────────────────────────────────────────────────────────────────
type BatchType = "inbound" | "outbound";
type BatchStatus = "Created" | "In Transit" | "Completed" | "Archived";
type View =
  | "dashboard"
  | "batches"
  | "batch"
  | "inbound"
  | "outbound"
  | "eow"
  | "archive"
  | "species"
  | "companies"
  | "settings";

type Toast = { id: string; type: "success" | "error" | "info"; message: string };
type SpeciesLine = { species: string; weightKg: number };
type TransportLeg = { transportCompany: string; vehicleReg: string; handoverTime: string; notes?: string };

interface Batch {
  id: string;
  batchType: BatchType;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;

  fromCompany: string;
  toCompany: string;

  vesselRef: string;
  orderDate: string;
  lotRef: string;
  notes: string;

  speciesLines: SpeciesLine[];
  transportLegs: TransportLeg[];

  archived?: boolean;

  landingCertNo?: string;
  processingCertNo?: string;
  catchCertNo?: string;
  healthCertNo?: string;
  landingPort?: string;
  processingPlant?: string;

  sentAt?: string;
  receivedAt?: string;
  locked?: boolean;
}

// ─── STORAGE ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = "batchidpro_v1";
const OUR_COMPANY_KEY = "batchidpro_ourcompany";
const SPECIES_KEY = "batchidpro_species";
const COMPANY_KEY = "batchidpro_companies";
const LOCAL_SESSION_KEY = "batchidpro_local_session";

const DEFAULT_SPECIES = [
  "Cod",
  "Haddock",
  "Hake",
  "Whiting",
  "Monkfish",
  "Scallops",
  "Mackerel",
  "Herring",
  "Plaice",
  "Sole",
  "Nephrops (Prawns)",
  "Pollock",
  "Skate",
];

const DEFAULT_COMPANIES = [
  "Portavogie Fish Co.",
  "Ards Marine",
  "Lough Catch Ltd",
  "North Coast Supplies",
  "Kilkeel Seafoods",
  "Belfast Cold Store",
  "McIlroy Logistics",
  "NI Reefer Haulage",
  "SeaChain Transport",
  "ColdRun Ltd",
];

function loadBatches(): Batch[] {
  return lsJson<Batch[]>(STORAGE_KEY, []);
}
function saveBatches(b: Batch[]) {
  lsSet(STORAGE_KEY, JSON.stringify(b));
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(16).slice(2, 10).toUpperCase();
const nowISO = () => new Date().toISOString();
const fmtDate = (s: string) => {
  try {
    return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return s;
  }
};
const fmtDT = (s: string) => {
  try {
    return new Date(s).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
};
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const round2 = (n: number) => Math.round(n * 100) / 100;
const totalKg = (b: Batch) => round2((b.speciesLines || []).reduce((a, l) => a + (+l.weightKg || 0), 0));
const speciesSummary = (b: Batch) => {
  const lines = (b.speciesLines || []).filter((l) => l.species);
  if (!lines.length) return "—";
  return lines.length === 1 ? lines[0].species : `${lines[0].species} +${lines.length - 1}`;
};

function encodeBatch(batch: Batch): string {
  try {
    const d = {
      id: batch.id,
      batchType: batch.batchType,
      status: batch.status,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      fromCompany: batch.fromCompany,
      toCompany: batch.toCompany,
      vesselRef: batch.vesselRef,
      orderDate: batch.orderDate,
      lotRef: batch.lotRef,
      notes: batch.notes,
      speciesLines: batch.speciesLines,
      transportLegs: (batch.transportLegs || []).map((l) => ({
        transportCompany: l.transportCompany,
        vehicleReg: l.vehicleReg,
        handoverTime: l.handoverTime,
        notes: l.notes,
      })),
      landingCertNo: batch.landingCertNo,
      processingCertNo: batch.processingCertNo,
      catchCertNo: batch.catchCertNo,
      healthCertNo: batch.healthCertNo,
      landingPort: batch.landingPort,
      processingPlant: batch.processingPlant,
      sentAt: batch.sentAt,
      receivedAt: batch.receivedAt,
      locked: batch.locked,
    };

    return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(d)))));
  } catch {
    return "";
  }
}

function safeDecode(encoded: string): any | null {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(encoded)))));
  } catch {
    return null;
  }
}

// ─── SUPABASE HELPERS ────────────────────────────────────────────────────────
async function sbUpsertBatch(batch: Batch): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  try {
    const payload = {
      id: batch.id,
      data: batch,
      status: batch.status,
      batch_type: batch.batchType,
      from_company: batch.fromCompany,
      to_company: batch.toCompany,
      sent_at: batch.sentAt ?? null,
      received_at: batch.receivedAt ?? null,
      locked: !!batch.locked,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("batches").upsert(payload, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Unknown error" };
  }
}

async function sbFetchBatchById(id: string): Promise<{ ok: boolean; batch?: Batch; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  try {
    const { data, error } = await supabase.from("batches").select("data").eq("id", id).maybeSingle();
    if (error) return { ok: false, error: error.message };
    const b = (data?.data ?? null) as Batch | null;
    if (!b) return { ok: false, error: "Not found" };
    return { ok: true, batch: b };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Unknown error" };
  }
}

async function sbConfirmReceipt(id: string): Promise<{ ok: boolean; batch?: Batch; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const f = await sbFetchBatchById(id);
  if (!f.ok || !f.batch) return { ok: false, error: f.error || "Not found" };
  const b = f.batch;

  if (b.status !== "In Transit") {
    return { ok: false, error: `Cannot confirm receipt because status is ${b.status}` };
  }

  const updated: Batch = {
    ...b,
    status: "Completed",
    receivedAt: nowISO(),
    locked: true,
    updatedAt: nowISO(),
  };

  const u = await sbUpsertBatch(updated);
  if (!u.ok) return { ok: false, error: u.error || "Update failed" };
  return { ok: true, batch: updated };
}

// ─── WORKFLOW GUARDS ─────────────────────────────────────────────────────────
function isLocked(b: Batch): boolean {
  return !!b.locked || b.status === "In Transit" || b.status === "Completed";
}
function canConfirmShipment(b: Batch): boolean {
  return b.batchType === "outbound" && b.status === "Created" && !isLocked(b);
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const S = {
  app: {
    minHeight: "100vh",
    background: "#080D14",
    color: "#E8EDF5",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  container: { maxWidth: 1200, margin: "0 auto", padding: "24px 16px 80px" },
  header: {
    background: "rgba(255,255,255,0.03)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  logo: { height: 38, borderRadius: 8 },
  appName: { fontSize: 16, fontWeight: 900 },
  nav: { display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" as const },
  navBtn: {
    cursor: "pointer",
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: 700,
  },
  navBtnActive: {
    borderColor: "rgba(249,115,22,0.35)",
    background: "rgba(249,115,22,0.14)",
    color: "#F97316",
  },
  card: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    overflow: "hidden" as const,
  },
  cardPad: { padding: 20 },
  cardHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: 900 },
  btn: {
    cursor: "pointer",
    padding: "9px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: 700,
  },
  btnPrimary: {
    borderColor: "rgba(249,115,22,0.45)",
    background: "rgba(249,115,22,0.18)",
    color: "#F97316",
  },
  btnSecondary: {
    borderColor: "rgba(59,130,246,0.45)",
    background: "rgba(59,130,246,0.14)",
    color: "#3B82F6",
  },
  btnDanger: {
    borderColor: "rgba(239,68,68,0.45)",
    background: "rgba(239,68,68,0.14)",
    color: "#EF4444",
  },
  btnOk: {
    borderColor: "rgba(34,197,94,0.45)",
    background: "rgba(34,197,94,0.14)",
    color: "#22C55E",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#E8EDF5",
    fontSize: 14,
  },
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    opacity: 0.6,
    marginBottom: 6,
  },
  tabBtn: {
    cursor: "pointer",
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "#E8EDF5",
    fontSize: 13,
    fontWeight: 700,
  },
  tabBtnActive: {
    borderColor: "rgba(249,115,22,0.35)",
    background: "rgba(249,115,22,0.14)",
    color: "#F97316",
  },
};

// ─── PUBLIC RECEIPT PAGE ─────────────────────────────────────────────────────
function PublicReceipt({ receiptId, encoded }: { receiptId: string; encoded: string | null }) {
  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState<any | null>(null);
  const [err, setErr] = useState<string>("");
  const [done, setDone] = useState(false);

  const setFromEncoded = useCallback(() => {
    if (!encoded) return false;
    const decoded = safeDecode(encoded);
    if (decoded && decoded.id === receiptId) {
      setBatch(decoded);
      return true;
    }
    return false;
  }, [encoded, receiptId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setErr("");
      setDone(false);

      const okEncoded = setFromEncoded();

      if (supabase) {
        const f = await sbFetchBatchById(receiptId);
        if (mounted) {
          if (f.ok && f.batch) {
            setBatch(f.batch);
          } else if (!okEncoded) {
            setErr(f.error || "Receipt not found");
          }
        }
      } else {
        if (mounted && !okEncoded)
          setErr("Receipt link incomplete (missing encoded data) and no online database configured.");
      }

      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [receiptId, setFromEncoded]);

  const statusColor = (s: string) => (s === "Completed" ? "#22C55E" : s === "In Transit" ? "#F59E0B" : "#3B82F6");
  const typeBg = (t: string) => (t === "inbound" ? "rgba(59,130,246,0.15)" : "rgba(249,115,22,0.15)");
  const typeColor = (t: string) => (t === "inbound" ? "#3B82F6" : "#F97316");

  const fmtD = (s: string) => {
    try {
      return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
    } catch {
      return s || "—";
    }
  };
  const fmtDTT = (s: string) => {
    try {
      return new Date(s).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return s || "—";
    }
  };

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#080D14;color:#E8EDF5;font-family:system-ui,sans-serif;min-height:100vh}
    .wrap{max-width:700px;margin:0 auto;padding:28px 16px 60px}
    .hdr{display:flex;align-items:center;gap:14px;margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,0.07)}
    .hdr img{height:48px;border-radius:10px}
    .hdr h1{font-size:18px;font-weight:900}
    .bid{font-size:11px;font-family:monospace;opacity:0.5;margin-top:3px}
    .badge{display:inline-flex;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:800;margin-left:auto}
    .section{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:18px;margin-bottom:12px}
    .sec-label{font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;opacity:0.5;margin-bottom:12px}
    .kv{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}
    .kv:last-child{border:none;padding-bottom:0}
    .kv-k{opacity:0.55}.kv-v{font-weight:700;text-align:right}
    .sp-row{display:flex;justify-content:space-between;padding:9px 12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:9px;margin-bottom:7px;font-size:13px}
    .sp-name{font-weight:700}.sp-w{font-family:monospace;color:#F97316}
    .total{display:flex;justify-content:space-between;padding-top:10px;margin-top:4px;border-top:1px solid rgba(255,255,255,0.07);font-size:14px;font-weight:900}
    .cert-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
    .cert{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:9px;padding:10px 12px}
    .cert-l{font-size:10px;opacity:0.5;margin-bottom:4px}.cert-v{font-family:monospace;font-size:13px;font-weight:800}
    .btn{cursor:pointer;border-radius:12px;padding:12px 14px;font-weight:900;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:#E8EDF5}
    .btnPrimary{border-color:rgba(249,115,22,0.45);background:rgba(249,115,22,0.18);color:#F97316}
    .btnOk{border-color:rgba(34,197,94,0.45);background:rgba(34,197,94,0.14);color:#22C55E}
    .hint{font-size:12px;opacity:0.6;line-height:1.5;margin-top:8px}
    .footer{text-align:center;font-size:11px;opacity:0.35;margin-top:28px;padding-top:18px;border-top:1px solid rgba(255,255,255,0.06)}
    .warn{background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:12px 14px;margin-bottom:12px;font-size:13px;line-height:1.5}
  `;

  const onConfirmReceipt = async () => {
    if (!batch?.id) return;

    if (!supabase) {
      setErr("This build has no online database configured, so the sender system cannot be updated from this device.");
      setDone(true);
      return;
    }

    setErr("");
    const res = await sbConfirmReceipt(batch.id);
    if (!res.ok) {
      setErr(res.error || "Confirm failed");
      return;
    }
    setBatch(res.batch || batch);
    setDone(true);
  };

  if (loading) {
    return (
      <div>
        <style>{css}</style>
        <div className="wrap">
          <div style={{ opacity: 0.7, fontWeight: 800 }}>Loading receipt…</div>
        </div>
      </div>
    );
  }

  if (err && !batch) {
    return (
      <div>
        <style>{css}</style>
        <div className="wrap">
          <div className="warn">
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Receipt not available</div>
            <div>{err}</div>
          </div>
          <div className="footer">Powered by Core Systems NI · Batch ID Pro</div>
        </div>
      </div>
    );
  }

  const totalW = ((batch?.speciesLines || []).reduce((a: number, l: any) => a + (+l.weightKg || 0), 0)).toFixed(2);
  const hasCerts = batch?.landingCertNo || batch?.processingCertNo || batch?.catchCertNo || batch?.healthCertNo;

  return (
    <div>
      <style>{css}</style>
      <div className="wrap">
        <div className="hdr">
          <img src={LOGO_URL} alt="Batch ID Pro" />
          <div>
            <h1>
              Batch Receipt{" "}
              <span
                style={{
                  display: "inline-flex",
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 900,
                  background: typeBg(batch.batchType),
                  color: typeColor(batch.batchType),
                  border: `1px solid ${typeColor(batch.batchType)}44`,
                  marginLeft: 8,
                  verticalAlign: "middle",
                }}
              >
                {batch.batchType}
              </span>
            </h1>
            <div className="bid">ID: {batch.id}</div>
          </div>
          <span
            className="badge"
            style={{
              background: `${statusColor(batch.status)}22`,
              color: statusColor(batch.status),
              border: `1px solid ${statusColor(batch.status)}55`,
            }}
          >
            {batch.status}
          </span>
        </div>

        {err && (
          <div className="warn">
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Note</div>
            <div>{err}</div>
          </div>
        )}

        {batch.status === "In Transit" && (
          <div className="section">
            <div className="sec-label">Recipient Confirmation</div>
            {!supabase ? (
              <>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Online confirmation is not enabled on this build.</div>
                <div className="hint">
                  This receipt page is running on a different device. Without Supabase (or another database), it cannot update the sender's system.
                  Enable Supabase to make "Confirm Receipt" update the batch instantly.
                </div>
              </>
            ) : (
              <>
                <button className={`btn ${done ? "btnOk" : "btnPrimary"}`} onClick={onConfirmReceipt} disabled={done}>
                  {done ? "Receipt Confirmed ✅" : "Confirm Receipt"}
                </button>
                <div className="hint">
                  Pressing this will mark the batch as <b>Completed</b> and lock it permanently.
                </div>
              </>
            )}
          </div>
        )}

        <div className="section">
          <div className="sec-label">Batch Details</div>
          {[
            ["From", batch.fromCompany],
            ["To", batch.toCompany],
            ["Vessel / Ref", batch.vesselRef],
            ["Order Date", fmtD(batch.orderDate)],
            ["Lot Ref", batch.lotRef],
            ["Created", fmtDTT(batch.createdAt)],
            ["Sent", batch.sentAt ? fmtDTT(batch.sentAt) : ""],
            ["Received", batch.receivedAt ? fmtDTT(batch.receivedAt) : ""],
            ["Landing Port", batch.landingPort],
            ["Processing Plant", batch.processingPlant],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div className="kv" key={k as string}>
                <span className="kv-k">{k}</span>
                <span className="kv-v">{v as any}</span>
              </div>
            ))}
        </div>

        <div className="section">
          <div className="sec-label">Species & Weight</div>
          {(batch.speciesLines || []).map((l: any, i: number) => (
            <div className="sp-row" key={i}>
              <span className="sp-name">{l.species}</span>
              <span className="sp-w">{(+l.weightKg || 0).toFixed(2)} kg</span>
            </div>
          ))}
          <div className="total">
            <span>Total Weight</span>
            <span>{totalW} kg</span>
          </div>
        </div>

        {hasCerts && (
          <div className="section">
            <div className="sec-label">Certification Numbers</div>
            <div className="cert-grid">
              {[
                ["Landing Cert", batch.landingCertNo],
                ["Processing Cert", batch.processingCertNo],
                ["Catch Cert", batch.catchCertNo],
                ["Health Cert", batch.healthCertNo],
              ]
                .filter(([, v]) => v)
                .map(([l, v]) => (
                  <div className="cert" key={l as string}>
                    <div className="cert-l">{l}</div>
                    <div className="cert-v">{v as any}</div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {(batch.transportLegs || []).length > 0 && (
          <div className="section">
            <div className="sec-label">Transport / Handover</div>
            {batch.transportLegs.map((leg: any, i: number) => (
              <div
                key={i}
                style={{ paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.05)" }}
              >
                {[
                  ["Company", leg.transportCompany],
                  ["Vehicle Reg", leg.vehicleReg],
                  ["Handover", fmtDTT(leg.handoverTime)],
                  ["Notes", leg.notes],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div className="kv" key={k as string}>
                      <span className="kv-k">{k}</span>
                      <span className="kv-v">{v as any}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}

        {batch.notes && (
          <div className="section">
            <div className="sec-label">Notes</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.85 }}>{batch.notes}</p>
          </div>
        )}

        <div className="footer">Powered by Core Systems NI · Batch ID Pro</div>
      </div>
    </div>
  );
}

// ─── AUTH UI (SUPABASE) ───────────────────────────────────────────────────────
function AuthGate({ onAuthed }: { onAuthed: (session: Session) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!supabase) return;
    setBusy(true);
    setErr("");
    try {
      if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        if (data.session) onAuthed(data.session);
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password: pass });
        if (error) throw error;
        if (data.session) onAuthed(data.session);
        else setErr("Account created. If email confirmation is enabled, check your inbox.");
      }
    } catch (e: any) {
      setErr(e?.message || "Auth failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...S.app, display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ maxWidth: 520, width: "100%", ...S.card }}>
        <div style={S.cardPad}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <img src={LOGO_URL} alt={APP_NAME} style={{ height: 44, borderRadius: 10 }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 900 }}>{APP_NAME}</div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>Company account login</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button style={{ ...S.tabBtn, ...(mode === "signin" ? S.tabBtnActive : {}) }} onClick={() => setMode("signin")}>
              Sign in
            </button>
            <button style={{ ...S.tabBtn, ...(mode === "signup" ? S.tabBtnActive : {}) }} onClick={() => setMode("signup")}>
              Create account
            </button>
          </div>

          {err && (
            <div
              style={{
                padding: 10,
                borderRadius: 12,
                border: "1px solid rgba(239,68,68,0.35)",
                background: "rgba(239,68,68,0.12)",
                marginBottom: 10,
              }}
            >
              <div style={{ fontWeight: 800, color: "#EF4444", fontSize: 13 }}>Error</div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>{err}</div>
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <label style={S.label}>Email (company account)</label>
              <input style={S.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="company@domain.com" />
            </div>
            <div>
              <label style={S.label}>Password</label>
              <input type="password" style={S.input} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" />
            </div>
            <button style={{ ...S.btn, ...S.btnPrimary, padding: "12px 14px", fontWeight: 900 }} onClick={submit} disabled={busy || !email || !pass}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>

            <div style={{ fontSize: 12, opacity: 0.55, lineHeight: 1.5 }}>
              <b>Multi-user on one account:</b> If you want multiple staff to use one company account, simply share this login internally.
              If/when you want true multi-user memberships per company, we'll add a membership table + RLS later.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TOAST BAR ───────────────────────────────────────────────────────────────
function ToastBar({ toasts }: { toasts: Toast[] }) {
  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 9999, display: "grid", gap: 10 }}>
      {toasts.map((t) => {
        const bg = t.type === "success" ? "#22C55E" : t.type === "error" ? "#EF4444" : "#3B82F6";
        return (
          <div
            key={t.id}
            style={{
              background: `${bg}22`,
              border: `1px solid ${bg}55`,
              color: bg,
              borderRadius: 12,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 800,
              maxWidth: 320,
            }}
          >
            {t.message}
          </div>
        );
      })}
    </div>
  );
}

// ─── HEADER ──────────────────────────────────────────────────────────────────
function Header({
  view,
  setView,
  closeBatch,
  stats,
  onLogout,
  showLogout,
}: {
  view: View;
  setView: (v: View) => void;
  closeBatch: () => void;
  stats: any;
  onLogout: () => void;
  showLogout: boolean;
}) {
  return (
    <div style={S.header}>
      <img src={LOGO_URL} alt={APP_NAME} style={S.logo} />
      <div style={S.appName}>{APP_NAME}</div>
      <div style={S.nav}>
        <button
          style={{ ...S.navBtn, ...(view === "dashboard" ? S.navBtnActive : {}) }}
          onClick={() => {
            closeBatch();
            setView("dashboard");
          }}
        >
          Dashboard
        </button>
        <button
          style={{ ...S.navBtn, ...(view === "batches" ? S.navBtnActive : {}) }}
          onClick={() => {
            closeBatch();
            setView("batches");
          }}
        >
          Batches ({stats.total})
        </button>
        <button
          style={{ ...S.navBtn, ...(view === "outbound" ? S.navBtnActive : {}) }}
          onClick={() => {
            closeBatch();
            setView("outbound");
          }}
        >
          Outbound
        </button>
        <button
          style={{ ...S.navBtn, ...(view === "eow" ? S.navBtnActive : {}) }}
          onClick={() => {
            closeBatch();
            setView("eow");
          }}
        >
          EOW ({stats.completed})
        </button>
        <button
          style={{ ...S.navBtn, ...(view === "archive" ? S.navBtnActive : {}) }}
          onClick={() => {
            closeBatch();
            setView("archive");
          }}
        >
          Archive ({stats.archived})
        </button>
        {showLogout && (
          <button style={{ ...S.navBtn, ...S.btnDanger }} onClick={onLogout}>
            Logout
          </button>
        )}
      </div>
    </div>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function Dashboard({ stats, setView }: { stats: any; setView: (v: View) => void }) {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 18 }}>Dashboard</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <div style={S.card}>
          <div style={S.cardPad}>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>Active Batches</div>
            <div style={{ fontSize: 32, fontWeight: 900 }}>{stats.total}</div>
          </div>
        </div>
        <div style={S.card}>
          <div style={S.cardPad}>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>Inbound</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: "#3B82F6" }}>{stats.inbound}</div>
          </div>
        </div>
        <div style={S.card}>
          <div style={S.cardPad}>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>Outbound</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: "#F97316" }}>{stats.outbound}</div>
          </div>
        </div>
        <div style={S.card}>
          <div style={S.cardPad}>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>Completed</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: "#22C55E" }}>{stats.completed}</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24, display: "grid", gap: 12 }}>
        <button style={{ ...S.btn, ...S.btnPrimary, padding: "12px 14px", fontWeight: 900 }} onClick={() => setView("inbound")}>
          + Create Inbound Docket
        </button>
        <button style={{ ...S.btn, ...S.btnSecondary, padding: "12px 14px", fontWeight: 900 }} onClick={() => setView("batches")}>
          View All Batches
        </button>
      </div>
    </div>
  );
}

// ─── BATCHES VIEW ────────────────────────────────────────────────────────────
function BatchesView({
  batches,
  tab,
  setTab,
  openBatch,
  deleteBatch,
}: {
  batches: Batch[];
  tab: BatchStatus;
  setTab: (t: BatchStatus) => void;
  openBatch: (id: string) => void;
  deleteBatch: (id: string) => void;
}) {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 18 }}>Batches</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={{ ...S.tabBtn, ...(tab === "Created" ? S.tabBtnActive : {}) }} onClick={() => setTab("Created")}>
          Draft
        </button>
        <button style={{ ...S.tabBtn, ...(tab === "In Transit" ? S.tabBtnActive : {}) }} onClick={() => setTab("In Transit")}>
          In Transit
        </button>
      </div>

      {batches.length === 0 && (
        <div style={{ padding: 32, textAlign: "center", opacity: 0.6 }}>No batches in this status</div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {batches.map((b) => (
          <div key={b.id} style={S.card}>
            <div style={S.cardPad}>
              <div style={S.cardHead}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 4 }}>{b.id}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>
                    {cap(b.batchType)} · {fmtDate(b.createdAt)}
                  </div>
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    padding: "4px 12px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                    background: b.batchType === "inbound" ? "rgba(59,130,246,0.15)" : "rgba(249,115,22,0.15)",
                    color: b.batchType === "inbound" ? "#3B82F6" : "#F97316",
                    border: `1px solid ${b.batchType === "inbound" ? "#3B82F6" : "#F97316"}44`,
                  }}
                >
                  {b.status}
                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
                <div>
                  <b>From:</b> {b.fromCompany}
                </div>
                <div>
                  <b>To:</b> {b.toCompany}
                </div>
                <div>
                  <b>Species:</b> {speciesSummary(b)} · <b>{totalKg(b)} kg</b>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => openBatch(b.id)}>
                  View
                </button>
                {!isLocked(b) && (
                  <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => deleteBatch(b.id)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CREATE DOCKET VIEW ──────────────────────────────────────────────────────
function CreateDocketView({
  batchType,
  createBatch,
  speciesLibrary,
  companyLibrary,
  addToast,
  setView,
}: {
  batchType: BatchType;
  createBatch: (b: Batch) => Promise<void>;
  speciesLibrary: string[];
  companyLibrary: string[];
  addToast: (type: Toast["type"], message: string) => void;
  setView: (v: View) => void;
}) {
  const [form, setForm] = useState({
    fromCompany: "",
    toCompany: "",
    vesselRef: "",
    orderDate: new Date().toISOString().split("T")[0],
    lotRef: "",
    notes: "",
    landingCertNo: "",
    processingCertNo: "",
    catchCertNo: "",
    healthCertNo: "",
    landingPort: "",
    processingPlant: "",
  });

  const [speciesLines, setSpeciesLines] = useState<SpeciesLine[]>([{ species: "", weightKg: 0 }]);
  const [transportLegs, setTransportLegs] = useState<TransportLeg[]>([]);

  const updateForm = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const addSpeciesLine = () => setSpeciesLines((p) => [...p, { species: "", weightKg: 0 }]);
  const removeSpeciesLine = (i: number) => setSpeciesLines((p) => p.filter((_, idx) => idx !== i));
  const updateSpeciesLine = (i: number, k: keyof SpeciesLine, v: any) =>
    setSpeciesLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const addTransportLeg = () =>
    setTransportLegs((p) => [...p, { transportCompany: "", vehicleReg: "", handoverTime: nowISO(), notes: "" }]);
  const removeTransportLeg = (i: number) => setTransportLegs((p) => p.filter((_, idx) => idx !== i));
  const updateTransportLeg = (i: number, k: keyof TransportLeg, v: any) =>
    setTransportLegs((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const submit = async () => {
    if (!form.fromCompany || !form.toCompany || !form.vesselRef) {
      addToast("error", "Missing required fields (From, To, Vessel)");
      return;
    }

    const cleanSpecies = speciesLines.filter((l) => l.species && +l.weightKg > 0);
    if (cleanSpecies.length === 0) {
      addToast("error", "Add at least one species with weight > 0");
      return;
    }

    const batch: Batch = {
      id: uid(),
      batchType,
      status: "Created",
      createdAt: nowISO(),
      updatedAt: nowISO(),
      fromCompany: form.fromCompany,
      toCompany: form.toCompany,
      vesselRef: form.vesselRef,
      orderDate: form.orderDate,
      lotRef: form.lotRef,
      notes: form.notes,
      speciesLines: cleanSpecies,
      transportLegs,
      landingCertNo: form.landingCertNo,
      processingCertNo: form.processingCertNo,
      catchCertNo: form.catchCertNo,
      healthCertNo: form.healthCertNo,
      landingPort: form.landingPort,
      processingPlant: form.processingPlant,
    };

    await createBatch(batch);
    setView("batches");
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 18 }}>Create {cap(batchType)} Docket</h1>

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.cardPad}>
          <div style={{ ...S.cardHead }}>
            <div style={S.cardTitle}>Basic Details</div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={S.label}>From Company</label>
              <input style={S.input} list="companies" value={form.fromCompany} onChange={(e) => updateForm("fromCompany", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>To Company</label>
              <input style={S.input} list="companies" value={form.toCompany} onChange={(e) => updateForm("toCompany", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Vessel / Reference</label>
              <input style={S.input} value={form.vesselRef} onChange={(e) => updateForm("vesselRef", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Order Date</label>
              <input type="date" style={S.input} value={form.orderDate} onChange={(e) => updateForm("orderDate", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Lot Reference</label>
              <input style={S.input} value={form.lotRef} onChange={(e) => updateForm("lotRef", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Landing Port</label>
              <input style={S.input} value={form.landingPort} onChange={(e) => updateForm("landingPort", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Processing Plant</label>
              <input style={S.input} value={form.processingPlant} onChange={(e) => updateForm("processingPlant", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Notes</label>
              <textarea
                style={{ ...S.input, minHeight: 80, resize: "vertical" as const }}
                value={form.notes}
                onChange={(e) => updateForm("notes", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.cardPad}>
          <div style={{ ...S.cardHead }}>
            <div style={S.cardTitle}>Certification Numbers</div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={S.label}>Landing Cert No.</label>
              <input style={S.input} value={form.landingCertNo} onChange={(e) => updateForm("landingCertNo", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Processing Cert No.</label>
              <input style={S.input} value={form.processingCertNo} onChange={(e) => updateForm("processingCertNo", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Catch Cert No.</label>
              <input style={S.input} value={form.catchCertNo} onChange={(e) => updateForm("catchCertNo", e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Health Cert No.</label>
              <input style={S.input} value={form.healthCertNo} onChange={(e) => updateForm("healthCertNo", e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.cardPad}>
          <div style={{ ...S.cardHead }}>
            <div style={S.cardTitle}>Species & Weight</div>
            <button style={{ ...S.btn, ...S.btnSecondary }} onClick={addSpeciesLine}>
              + Add Line
            </button>
          </div>
          {speciesLines.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <input
                  style={S.input}
                  list="species"
                  placeholder="Species"
                  value={l.species}
                  onChange={(e) => updateSpeciesLine(i, "species", e.target.value)}
                />
              </div>
              <div style={{ width: 140 }}>
                <input
                  type="number"
                  style={S.input}
                  placeholder="Weight (kg)"
                  value={l.weightKg || ""}
                  onChange={(e) => updateSpeciesLine(i, "weightKg", +e.target.value)}
                />
              </div>
              <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => removeSpeciesLine(i)}>
                Remove
              </button>
            </div>
          ))}
          <div style={{ marginTop: 12, fontWeight: 900, fontSize: 14 }}>
            Total: {round2(speciesLines.reduce((a, l) => a + (+l.weightKg || 0), 0))} kg
          </div>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.cardPad}>
          <div style={{ ...S.cardHead }}>
            <div style={S.cardTitle}>Transport / Handover</div>
            <button style={{ ...S.btn, ...S.btnSecondary }} onClick={addTransportLeg}>
              + Add Leg
            </button>
          </div>
          {transportLegs.map((leg, i) => (
            <div key={i} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <label style={S.label}>Transport Company</label>
                  <input
                    style={S.input}
                    list="companies"
                    value={leg.transportCompany}
                    onChange={(e) => updateTransportLeg(i, "transportCompany", e.target.value)}
                  />
                </div>
                <div>
                  <label style={S.label}>Vehicle Reg</label>
                  <input
                    style={S.input}
                    value={leg.vehicleReg}
                    onChange={(e) => updateTransportLeg(i, "vehicleReg", e.target.value)}
                  />
                </div>
                <div>
                  <label style={S.label}>Handover Time</label>
                  <input
                    type="datetime-local"
                    style={S.input}
                    value={leg.handoverTime?.slice(0, 16) || ""}
                    onChange={(e) => updateTransportLeg(i, "handoverTime", e.target.value ? new Date(e.target.value).toISOString() : "")}
                  />
                </div>
                <div>
                  <label style={S.label}>Notes</label>
                  <input
                    style={S.input}
                    value={leg.notes || ""}
                    onChange={(e) => updateTransportLeg(i, "notes", e.target.value)}
                  />
                </div>
                <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => removeTransportLeg(i)}>
                  Remove Leg
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <button style={{ ...S.btn, ...S.btnPrimary, padding: "12px 14px", fontWeight: 900 }} onClick={submit}>
          Create Docket
        </button>
        <button style={{ ...S.btn, ...S.btnSecondary, padding: "12px 14px" }} onClick={() => setView("dashboard")}>
          Cancel
        </button>
      </div>

      <datalist id="species">
        {speciesLibrary.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="companies">
        {companyLibrary.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

// ─── BATCH DETAIL ────────────────────────────────────────────────────────────
function BatchDetail({
  batch,
  updateBatch,
  deleteBatch,
  archiveBatch,
  unarchiveBatch,
  closeBatch,
  addToast,
  speciesLibrary,
  companyLibrary,
}: {
  batch: Batch;
  updateBatch: (id: string, updates: Partial<Batch>) => Promise<void>;
  deleteBatch: (id: string) => Promise<void>;
  archiveBatch: (id: string) => Promise<void>;
  unarchiveBatch: (id: string) => Promise<void>;
  closeBatch: () => void;
  addToast: (type: Toast["type"], message: string) => void;
  speciesLibrary: string[];
  companyLibrary: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...batch });

  const locked = isLocked(batch);
  const canConfirm = canConfirmShipment(batch);

  const updateForm = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  const saveEdits = async () => {
    await updateBatch(batch.id, form);
    setEditing(false);
    addToast("success", "Changes saved");
  };

  const confirmShipment = async () => {
    await updateBatch(batch.id, { status: "In Transit", sentAt: nowISO(), locked: true });
    addToast("success", "Shipment confirmed. Batch is now locked.");
  };

  const qrUrl = `${RESOLVER_BASE}/?receipt=${batch.id}&d=${encodeBatch(batch)}`;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={closeBatch}>
          ← Back
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 900 }}>Batch {batch.id}</h1>
        <div
          style={{
            display: "inline-flex",
            padding: "4px 12px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 800,
            background: batch.batchType === "inbound" ? "rgba(59,130,246,0.15)" : "rgba(249,115,22,0.15)",
            color: batch.batchType === "inbound" ? "#3B82F6" : "#F97316",
            border: `1px solid ${batch.batchType === "inbound" ? "#3B82F6" : "#F97316"}44`,
            marginLeft: "auto",
          }}
        >
          {batch.status}
        </div>
      </div>

      {locked && (
        <div
          style={{
            background: "rgba(245,158,11,0.12)",
            border: "1px solid rgba(245,158,11,0.25)",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
            fontSize: 13,
          }}
        >
          🔒 This batch is <b>locked</b> and cannot be edited (status: {batch.status}).
        </div>
      )}

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.cardPad}>
          <div style={S.cardHead}>
            <div style={S.cardTitle}>Batch Info</div>
            {!locked && !editing && (
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {editing && (
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...S.btn, ...S.btnPrimary }} onClick={saveEdits}>
                  Save
                </button>
                <button style={{ ...S.btn }} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          {!editing ? (
            <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
              <div>
                <b>From:</b> {batch.fromCompany}
              </div>
              <div>
                <b>To:</b> {batch.toCompany}
              </div>
              <div>
                <b>Vessel:</b> {batch.vesselRef}
              </div>
              <div>
                <b>Order Date:</b> {fmtDate(batch.orderDate)}
              </div>
              <div>
                <b>Lot Ref:</b> {batch.lotRef || "—"}
              </div>
              <div>
                <b>Landing Port:</b> {batch.landingPort || "—"}
              </div>
              <div>
                <b>Processing Plant:</b> {batch.processingPlant || "—"}
              </div>
              <div>
                <b>Created:</b> {fmtDT(batch.createdAt)}
              </div>
              {batch.sentAt && (
                <div>
                  <b>Sent:</b> {fmtDT(batch.sentAt)}
                </div>
              )}
              {batch.receivedAt && (
                <div>
                  <b>Received:</b> {fmtDT(batch.receivedAt)}
                </div>
              )}
              {batch.notes && (
                <div>
                  <b>Notes:</b> {batch.notes}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={S.label}>From Company</label>
                <input style={S.input} list="companies" value={form.fromCompany} onChange={(e) => updateForm("fromCompany", e.target.value)} />
              </div>
              <div>
                <label style={S.label}>To Company</label>
                <input style={S.input} list="companies" value={form.toCompany} onChange={(e) => updateForm("toCompany", e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Vessel</label>
                <input style={S.input} value={form.vesselRef} onChange={(e) => updateForm("vesselRef", e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Order Date</label>
                <input type="date" style={S.input} value={form.orderDate} onChange={(e) => updateForm("orderDate", e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Lot Ref</label>
                <input style={S.input} value={form.lotRef} onChange={(e) => updateForm("lotRef", e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Landing Port</label>
                <input style={S.input} value={form.landingPort} onChange={(e) => updateForm("landingPort", e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Processing Plant</label>
                <input style={S.input} value={form.processingPlant} onChange={(e) => updateForm("processingPlant", e.target.value)} />
              </div>
              <div>
                <label style={S.label}>Notes</label>
                <textarea style={{ ...S.input, minHeight: 80 }} value={form.notes} onChange={(e) => updateForm("notes", e.target.value)} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.cardPad}>
          <div style={S.cardHead}>
            <div style={S.cardTitle}>Certification Numbers</div>
          </div>
          <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
            <div>
              <b>Landing Cert:</b> {batch.landingCertNo || "—"}
            </div>
            <div>
              <b>Processing Cert:</b> {batch.processingCertNo || "—"}
            </div>
            <div>
              <b>Catch Cert:</b> {batch.catchCertNo || "—"}
            </div>
            <div>
              <b>Health Cert:</b> {batch.healthCertNo || "—"}
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.cardPad}>
          <div style={S.cardHead}>
            <div style={S.cardTitle}>Species & Weight</div>
          </div>
          {(batch.speciesLines || []).map((l, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 12px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 9,
                marginBottom: 6,
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 700 }}>{l.species}</span>
              <span style={{ fontFamily: "monospace", color: "#F97316" }}>{(+l.weightKg).toFixed(2)} kg</span>
            </div>
          ))}
          <div style={{ marginTop: 12, fontWeight: 900, fontSize: 14 }}>Total: {totalKg(batch)} kg</div>
        </div>
      </div>

      {(batch.transportLegs || []).length > 0 && (
        <div style={{ ...S.card, marginBottom: 14 }}>
          <div style={S.cardPad}>
            <div style={S.cardHead}>
              <div style={S.cardTitle}>Transport / Handover</div>
            </div>
            {batch.transportLegs.map((leg, i) => (
              <div
                key={i}
                style={{
                  paddingBottom: 12,
                  marginBottom: 12,
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  <div>
                    <b>Company:</b> {leg.transportCompany}
                  </div>
                  <div>
                    <b>Vehicle:</b> {leg.vehicleReg}
                  </div>
                  <div>
                    <b>Handover:</b> {fmtDT(leg.handoverTime)}
                  </div>
                  {leg.notes && (
                    <div>
                      <b>Notes:</b> {leg.notes}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {canConfirm && (
        <div style={{ ...S.card, marginBottom: 14 }}>
          <div style={S.cardPad}>
            <div style={S.cardHead}>
              <div style={S.cardTitle}>Confirm Shipment</div>
            </div>
            <button style={{ ...S.btn, ...S.btnPrimary, padding: "12px 14px", fontWeight: 900 }} onClick={confirmShipment}>
              Confirm Shipment (Lock & Send)
            </button>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
              This will mark the batch as "In Transit" and lock it. Generate the QR code for the recipient.
            </div>
          </div>
        </div>
      )}

      {batch.status === "In Transit" && (
        <div style={{ ...S.card, marginBottom: 14 }}>
          <div style={S.cardPad}>
            <div style={S.cardHead}>
              <div style={S.cardTitle}>Receipt QR Code</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <QRCodeSVG value={qrUrl} size={180} />
              <div style={{ fontSize: 12, opacity: 0.6, textAlign: "center" }}>
                Recipient scans this QR to confirm receipt. Or share this link:
              </div>
              <a
                href={qrUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: "#F97316", fontWeight: 800, wordBreak: "break-all" }}
              >
                {qrUrl}
              </a>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
        {batch.archived ? (
          <button style={{ ...S.btn, ...S.btnOk }} onClick={() => unarchiveBatch(batch.id)}>
            Unarchive
          </button>
        ) : (
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => archiveBatch(batch.id)}>
            Archive
          </button>
        )}
        {!locked && (
          <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => deleteBatch(batch.id)}>
            Delete
          </button>
        )}
      </div>

      <datalist id="species">
        {speciesLibrary.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="companies">
        {companyLibrary.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

// ─── OUTBOUND SENT VIEW ──────────────────────────────────────────────────────
function OutboundSentView({ batches, openBatch }: { batches: Batch[]; openBatch: (id: string) => void }) {
  const outbound = useMemo(
    () => batches.filter((b) => b.batchType === "outbound" && !b.archived && b.status !== "Completed"),
    [batches]
  );

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 18 }}>Outbound Batches</h1>

      {outbound.length === 0 && (
        <div style={{ padding: 32, textAlign: "center", opacity: 0.6 }}>No outbound batches</div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {outbound.map((b) => (
          <div key={b.id} style={S.card}>
            <div style={S.cardPad}>
              <div style={S.cardHead}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 4 }}>{b.id}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>{fmtDate(b.createdAt)}</div>
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    padding: "4px 12px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                    background: "rgba(249,115,22,0.15)",
                    color: "#F97316",
                    border: "1px solid #F9731644",
                  }}
                >
                  {b.status}
                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
                <div>
                  <b>To:</b> {b.toCompany}
                </div>
                <div>
                  <b>Species:</b> {speciesSummary(b)} · <b>{totalKg(b)} kg</b>
                </div>
              </div>

              <button style={{ ...S.btn, ...S.btnSecondary, marginTop: 12 }} onClick={() => openBatch(b.id)}>
                View Batch
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── EOW VIEW ────────────────────────────────────────────────────────────────
function EOWView({ batches, openBatch }: { batches: Batch[]; openBatch: (id: string) => void }) {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 18 }}>End of Week (Completed Batches)</h1>

      {batches.length === 0 && (
        <div style={{ padding: 32, textAlign: "center", opacity: 0.6 }}>No completed batches</div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {batches.map((b) => (
          <div key={b.id} style={S.card}>
            <div style={S.cardPad}>
              <div style={S.cardHead}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 4 }}>{b.id}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>
                    {cap(b.batchType)} · Completed {fmtDate(b.receivedAt || b.updatedAt)}
                  </div>
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    padding: "4px 12px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                    background: "rgba(34,197,94,0.15)",
                    color: "#22C55E",
                    border: "1px solid #22C55E44",
                  }}
                >
                  Completed
                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
                <div>
                  <b>From:</b> {b.fromCompany}
                </div>
                <div>
                  <b>To:</b> {b.toCompany}
                </div>
                <div>
                  <b>Species:</b> {speciesSummary(b)} · <b>{totalKg(b)} kg</b>
                </div>
              </div>

              <button style={{ ...S.btn, ...S.btnSecondary, marginTop: 12 }} onClick={() => openBatch(b.id)}>
                View
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ARCHIVE VIEW ────────────────────────────────────────────────────────────
function ArchiveView({
  batches,
  openBatch,
  unarchiveBatch,
}: {
  batches: Batch[];
  openBatch: (id: string) => void;
  unarchiveBatch: (id: string) => Promise<void>;
}) {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 18 }}>Archived Batches</h1>

      {batches.length === 0 && (
        <div style={{ padding: 32, textAlign: "center", opacity: 0.6 }}>No archived batches</div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {batches.map((b) => (
          <div key={b.id} style={S.card}>
            <div style={S.cardPad}>
              <div style={S.cardHead}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 4 }}>{b.id}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>
                    {cap(b.batchType)} · {fmtDate(b.createdAt)}
                  </div>
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    padding: "4px 12px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                    background: "rgba(156,163,175,0.15)",
                    color: "#9CA3AF",
                    border: "1px solid #9CA3AF44",
                  }}
                >
                  Archived
                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
                <div>
                  <b>From:</b> {b.fromCompany}
                </div>
                <div>
                  <b>To:</b> {b.toCompany}
                </div>
                <div>
                  <b>Species:</b> {speciesSummary(b)} · <b>{totalKg(b)} kg</b>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => openBatch(b.id)}>
                  View
                </button>
                {b.status !== "Completed" && !isLocked(b) && (
                  <button style={{ ...S.btn, ...S.btnOk }} onClick={() => unarchiveBatch(b.id)}>
                    Unarchive
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LIBRARY VIEW ────────────────────────────────────────────────────────────
function LibraryView({
  title,
  items,
  setItems,
  addToast,
}: {
  title: string;
  items: string[];
  setItems: (items: string[]) => void;
  addToast: (type: Toast["type"], message: string) => void;
}) {
  const [newItem, setNewItem] = useState("");

  const add = () => {
    if (!newItem.trim()) return;
    if (items.includes(newItem.trim())) {
      addToast("error", "Already exists");
      return;
    }
    setItems([...items, newItem.trim()]);
    setNewItem("");
    addToast("success", "Added");
  };

  const remove = (item: string) => {
    setItems(items.filter((i) => i !== item));
    addToast("info", "Removed");
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 18 }}>{title}</h1>

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.cardPad}>
          <div style={{ display: "flex", gap: 10 }}>
            <input style={{ ...S.input, flex: 1 }} value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add new..." />
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={add}>
              Add
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {items.map((item) => (
          <div key={item} style={S.card}>
            <div style={{ ...S.cardPad, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{item}</div>
              <button style={{ ...S.btn, ...S.btnDanger }} onClick={() => remove(item)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SETTINGS VIEW ───────────────────────────────────────────────────────────
function SettingsView({ addToast }: { addToast: (type: Toast["type"], message: string) => void }) {
  const [ourCompany, setOurCompany] = useState(() => lsGet(OUR_COMPANY_KEY) || "");

  const save = () => {
    lsSet(OUR_COMPANY_KEY, ourCompany);
    addToast("success", "Settings saved");
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 18 }}>Settings</h1>

      <div style={S.card}>
        <div style={S.cardPad}>
          <div style={S.cardHead}>
            <div style={S.cardTitle}>Company Info</div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={S.label}>Your Company Name</label>
              <input style={S.input} value={ourCompany} onChange={(e) => setOurCompany(e.target.value)} />
            </div>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const receiptId = params.get("receipt");
    const encoded = params.get("d");
    if (receiptId) return <PublicReceipt receiptId={receiptId} encoded={encoded} />;
  }

  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setSession(data.session ?? null);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (supabase && !session) {
    return <AuthGate onAuthed={(s) => setSession(s)} />;
  }

  const [localSession, setLocalSession] = useState(() => lsGet(LOCAL_SESSION_KEY) || "ok");
  useEffect(() => {
    if (!supabase) lsSet(LOCAL_SESSION_KEY, localSession || "ok");
  }, [localSession]);

  const [view, setView] = useState<View>("dashboard");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const [batches, setBatches] = useState<Batch[]>(() => loadBatches());
  const [speciesLibrary, setSpeciesLibrary] = useState<string[]>(() => lsJson(SPECIES_KEY, DEFAULT_SPECIES));
  const [companyLibrary, setCompanyLibrary] = useState<string[]>(() => lsJson(COMPANY_KEY, DEFAULT_COMPANIES));

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [batchTab, setBatchTab] = useState<BatchStatus>("Created");

  useEffect(() => {
    saveBatches(batches);
  }, [batches]);

  useEffect(() => {
    lsSet(SPECIES_KEY, JSON.stringify(speciesLibrary));
  }, [speciesLibrary]);

  useEffect(() => {
    lsSet(COMPANY_KEY, JSON.stringify(companyLibrary));
  }, [companyLibrary]);

  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = uid();
    setToasts((p) => [...p, { id, type, message }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3200);
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    let mounted = true;

    (async () => {
      const { data, error } = await supabase.from("batches").select("data").order("updated_at", { ascending: false }).limit(300);
      if (!mounted) return;
      if (error) {
        addToast("error", `Supabase sync failed: ${error.message}`);
        return;
      }
      const remote = (data || []).map((r: any) => r.data as Batch).filter(Boolean);
      if (remote.length) {
        setBatches(remote);
        addToast("info", `Synced ${remote.length} batches`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [session, addToast]);

  const createBatch = useCallback(
    async (b: Batch) => {
      setBatches((p) => [b, ...p]);
      addToast("success", "Docket created");

      if (supabase && session) {
        const r = await sbUpsertBatch(b);
        if (!r.ok) addToast("error", `Supabase save failed: ${r.error}`);
      }
    },
    [addToast, session]
  );

  const updateBatch = useCallback(
    async (id: string, updates: Partial<Batch>) => {
      setBatches((p) => p.map((b) => (b.id === id ? { ...b, ...updates, updatedAt: nowISO() } : b)));

      if (supabase && session) {
        const current = batches.find((x) => x.id === id);
        const merged = current ? ({ ...current, ...updates, updatedAt: nowISO() } as Batch) : null;
        if (merged) {
          const r = await sbUpsertBatch(merged);
          if (!r.ok) addToast("error", `Supabase update failed: ${r.error}`);
        }
      }
    },
    [session, addToast, batches]
  );

  const deleteBatch = useCallback(
    async (id: string) => {
      const b = batches.find((x) => x.id === id);
      if (b && isLocked(b)) {
        addToast("error", "This batch is locked and cannot be deleted.");
        return;
      }

      setBatches((p) => p.filter((x) => x.id !== id));
      setView("batches");
      addToast("info", "Deleted");

      if (supabase && session) {
        const { error } = await supabase.from("batches").delete().eq("id", id);
        if (error) addToast("error", `Supabase delete failed: ${error.message}`);
      }
    },
    [addToast, batches, session]
  );

  const archiveBatch = useCallback(
    async (id: string) => {
      const b = batches.find((x) => x.id === id);
      if (b && isLocked(b)) {
        await updateBatch(id, { archived: true, status: "Archived", locked: true });
        addToast("success", "Archived");
        return;
      }
      await updateBatch(id, { archived: true, status: "Archived" });
      addToast("success", "Archived");
    },
    [batches, updateBatch, addToast]
  );

  const unarchiveBatch = useCallback(
    async (id: string) => {
      const b = batches.find((x) => x.id === id);
      if (b && b.status === "Archived") {
        const wasSent = !!b.sentAt || b.status === "In Transit" || b.status === "Completed";
        if (wasSent) {
          addToast("error", "Sent/completed batches cannot be unarchived back into draft.");
          return;
        }
        await updateBatch(id, { archived: false, status: "Created", locked: false });
        addToast("success", "Unarchived");
      }
    },
    [batches, updateBatch, addToast]
  );

  const openBatch = useCallback((id: string) => {
    setSelectedBatchId(id);
    setView("batch");
  }, []);

  const closeBatch = useCallback(() => {
    setSelectedBatchId(null);
    setView("batches");
  }, []);

  const activeBatches = useMemo(
    () => batches.filter((b) => !b.archived && (b.status === "Created" || b.status === "In Transit")),
    [batches]
  );
  const completedBatches = useMemo(() => batches.filter((b) => !b.archived && b.status === "Completed"), [batches]);
  const archivedBatches = useMemo(() => batches.filter((b) => b.archived), [batches]);

  const filteredBatches = useMemo(() => {
    return activeBatches.filter((b) => b.status === batchTab);
  }, [activeBatches, batchTab]);

  const selectedBatch = useMemo(
    () => (selectedBatchId ? batches.find((b) => b.id === selectedBatchId) || null : null),
    [batches, selectedBatchId]
  );

  const stats = useMemo(
    () => ({
      total: activeBatches.length,
      inbound: activeBatches.filter((b) => b.batchType === "inbound").length,
      outbound: activeBatches.filter((b) => b.batchType === "outbound").length,
      completed: completedBatches.length,
      archived: archivedBatches.length,
    }),
    [activeBatches, completedBatches, archivedBatches]
  );

  const doLogout = useCallback(async () => {
    setSelectedBatchId(null);
    setView("dashboard");

    if (supabase) {
      await supabase.auth.signOut();
      return;
    }

    lsDel(LOCAL_SESSION_KEY);
    setLocalSession("ok");
    addToast("info", "Logged out");
  }, [addToast]);

  return (
    <div style={S.app}>
      <ToastBar toasts={toasts} />
      <Header view={view} setView={setView} closeBatch={closeBatch} stats={stats} onLogout={doLogout} showLogout={!!supabase || !!localSession} />
      <div style={S.container}>
        {view === "dashboard" && <Dashboard stats={stats} setView={setView} />}
        {view === "batches" && <BatchesView batches={filteredBatches} tab={batchTab} setTab={setBatchTab} openBatch={openBatch} deleteBatch={deleteBatch} />}
        {view === "inbound" && (
          <CreateDocketView
            batchType="inbound"
            createBatch={createBatch}
            speciesLibrary={speciesLibrary}
            companyLibrary={companyLibrary}
            addToast={addToast}
            setView={setView}
          />
        )}
        {view === "outbound" && <OutboundSentView batches={batches} openBatch={openBatch} />}
        {view === "batch" && selectedBatch && (
          <BatchDetail
            batch={selectedBatch}
            updateBatch={updateBatch}
            deleteBatch={deleteBatch}
            archiveBatch={archiveBatch}
            unarchiveBatch={unarchiveBatch}
            closeBatch={closeBatch}
            addToast={addToast}
            speciesLibrary={speciesLibrary}
            companyLibrary={companyLibrary}
          />
        )}
        {view === "batch" && !selectedBatch && (
          <div style={{ padding: 32 }}>
            <h2>Batch not found</h2>
            <button style={{ ...S.btn, ...S.btnSecondary, marginTop: 16 }} onClick={() => setView("dashboard")}>
              Back to Dashboard
            </button>
          </div>
        )}
        {view === "eow" && <EOWView batches={completedBatches} openBatch={openBatch} />}
        {view === "archive" && <ArchiveView batches={archivedBatches} openBatch={openBatch} unarchiveBatch={unarchiveBatch} />}
        {view === "species" && <LibraryView title="Species Library" items={speciesLibrary} setItems={setSpeciesLibrary} addToast={addToast} />}
        {view === "companies" && <LibraryView title="Companies Library" items={companyLibrary} setItems={setCompanyLibrary} addToast={addToast} />}
        {view === "settings" && <SettingsView addToast={addToast} />}
      </div>
    </div>
  );
}