// Batch ID Pro — Single-File App (V1.1 — CONFIRM + LOCK + QR RECEIPT CONFIRM + LOGOUT + (OPTIONAL) SUPABASE)
// QR codes point to resolver at https://batch.coresystemsni.com/?receipt=ID&d=ENCODED
// No router. Vite + React. TypeScript-safe.
//
// Key rules implemented:
// - Creating a docket = DRAFT ("Created").
// - Outbound "Confirm Shipment" moves to "In Transit" (a.k.a. SENT) and LOCKS the batch (no edits/deletes/flow changes).
// - Recipient confirms receipt via external docket (QR receipt page) => "Completed" + receivedAt, stays locked.
// - Outbound view shows SENT only (In Transit + Completed).
// - Logout + auth gate when Supabase is configured.
// - Hybrid persistence: Supabase when configured, else localStorage fallback.
//   NOTE: External receipt confirmation only truly works with Supabase because a phone scanning QR does not share your localStorage.

import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createClient, type Session, type User } from "@supabase/supabase-js";

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

// ─── SUPABASE (OPTIONAL) ─────────────────────────────────────────────────────
const SUPABASE_URL_RAW = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_RAW = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

// Normalize (handles accidental quotes/whitespace/newlines) and validate early so the whole app never hard-crashes.
const normalizeEnv = (v?: string) => {
  if (typeof v !== 'string') return undefined;
  // Trim + strip accidental wrapping quotes
  let s = v.trim().replace(/^['"]|['"]$/g, '');
  // Some deployments accidentally prefix the URL with "supabase:" (e.g. "supabase:https://...")
  s = s.replace(/^supabase:\s*/i, '');
  return s;
};

const SUPABASE_URL = normalizeEnv(SUPABASE_URL_RAW)?.replace(/\/+$/g, '');
const SUPABASE_ANON = normalizeEnv(SUPABASE_ANON_RAW);

const isValidHttpUrl = (u?: string) => {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

const supabase = (() => {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  if (!isValidHttpUrl(SUPABASE_URL)) {
    console.error('[Batch ID Pro] Invalid SUPABASE URL (needs https://...). Value seen:', SUPABASE_URL);
    return null;
  }
  try {
    return createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true } });
  } catch (e) {
    console.error('[Batch ID Pro] Supabase init failed:', e);
    return null;
  }
})();
// Table expected (minimal):
// batches:
//  - id (text primary key)
//  - data (jsonb)   // full batch object
//  - status (text)
//  - batch_type (text)
//  - from_company (text)
//  - to_company (text)
//  - sent_at (timestamptz null)
//  - received_at (timestamptz null)
//  - locked (bool default false)
//  - updated_at (timestamptz default now())

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

  // NEW: workflow timestamps + lock
  sentAt?: string; // when shipment confirmed (outbound)
  receivedAt?: string; // when recipient confirms (external)
  locked?: boolean; // true once "In Transit" (or completed) to prevent changes
}

// ─── STORAGE ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = "batchidpro_v1";

// Local fallback persistence (only used when Supabase is not available)
const saveBatches = (items: any) => {
  try {
    lsSet(STORAGE_KEY, JSON.stringify(items ?? []));
  } catch {}
};

const OUR_COMPANY_KEY = "batchidpro_ourcompany";
const SPECIES_KEY = "batchidpro_species";
const COMPANY_KEY = "batchidpro_companies";

// optional: local "session" for non-supabase mode (basic logout)
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

// Local fallback (only used when Supabase is not configured)
function loadBatchesLocal(): Batch[] {
  return lsJson<Batch[]>(STORAGE_KEY, []);
}
function saveBatchesLocal(b: Batch[]) {
  lsSet(STORAGE_KEY, JSON.stringify(b));
}

// Supabase-backed batches (per your schema)
async function loadBatches(companyId: string): Promise<Batch[]> {
  if (!supabase) return loadBatchesLocal();

  const { data, error } = await supabase
    .from("batches")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading batches:", error);
    return [];
  }

  return (data || []).map((r: any) => {
    const status = (r.status as BatchStatus) || "Created";
    const updatedAt = r.updated_at || r.created_at || new Date().toISOString();
    return {
      id: String(r.id),
      batchType: r.batch_type as BatchType,
      status,
      createdAt: r.created_at || new Date().toISOString(),
      updatedAt,
      fromCompany: r.from_company || "",
      toCompany: r.to_company || "",
      vesselRef: r.vessel_ref || "",
      orderDate: r.order_date || "",
      lotRef: r.lot_ref || "",
      notes: r.notes || "",
      speciesLines: (r.species_lines || []) as SpeciesLine[],
      transportLegs: (r.transport_legs || []) as TransportLeg[],
      archived: !!r.archived,
      landingCertNo: r.landing_cert_no || "",
      processingCertNo: r.processing_cert_no || "",
      catchCertNo: r.catch_cert_no || "",
      healthCertNo: r.health_cert_no || "",
      landingPort: r.landing_port || "",
      processingPlant: r.processing_plant || "",
      // Derived (schema-safe)
      locked: status !== "Created",
      sentAt: status === "In Transit" ? updatedAt : undefined,
      receivedAt: status === "Completed" ? updatedAt : undefined,
    } as Batch;
  });
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

// Receipt data encoding (for redundancy on QR)
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
async function sbUpsertBatch(companyId: string, batch: Batch): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  try {
    const payload: any = {
      id: batch.id,
      company_id: companyId,
      batch_type: batch.batchType,
      status: batch.status,
      created_at: batch.createdAt,
      updated_at: batch.updatedAt,
      from_company: batch.fromCompany,
      to_company: batch.toCompany,
      vessel_ref: batch.vesselRef || null,
      order_date: batch.orderDate,
      lot_ref: batch.lotRef || null,
      notes: batch.notes || null,
      species_lines: batch.speciesLines || [],
      transport_legs: batch.transportLegs || [],
      archived: !!batch.archived,
      landing_cert_no: batch.landingCertNo || null,
      processing_cert_no: batch.processingCertNo || null,
      catch_cert_no: batch.catchCertNo || null,
      health_cert_no: batch.healthCertNo || null,
      landing_port: batch.landingPort || null,
      processing_plant: batch.processingPlant || null,
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
    const { data, error } = await supabase.from("batches").select("*").eq("id", id).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Not found" };

    const status = (data.status as BatchStatus) || "Created";
    const updatedAt = data.updated_at || data.created_at || new Date().toISOString();

    const b: Batch = {
      id: String(data.id),
      batchType: data.batch_type as BatchType,
      status,
      createdAt: data.created_at || new Date().toISOString(),
      updatedAt,
      fromCompany: data.from_company || "",
      toCompany: data.to_company || "",
      vesselRef: data.vessel_ref || "",
      orderDate: data.order_date || "",
      lotRef: data.lot_ref || "",
      notes: data.notes || "",
      speciesLines: (data.species_lines || []) as SpeciesLine[],
      transportLegs: (data.transport_legs || []) as TransportLeg[],
      archived: !!data.archived,
      landingCertNo: data.landing_cert_no || "",
      processingCertNo: data.processing_cert_no || "",
      catchCertNo: data.catch_cert_no || "",
      healthCertNo: data.health_cert_no || "",
      landingPort: data.landing_port || "",
      processingPlant: data.processing_plant || "",
      locked: status !== "Created",
      sentAt: status === "In Transit" ? updatedAt : undefined,
      receivedAt: status === "Completed" ? updatedAt : undefined,
    };

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

  // Only allow confirming if currently "In Transit" (or at least not Archived)
  if (b.status === "Archived") return { ok: false, error: "This docket is archived." };

  const next: Batch = {
    ...b,
    status: "Completed",
    updatedAt: new Date().toISOString(),
    locked: true,
    receivedAt: new Date().toISOString(),
  };

  try {
    // Update row by id (no company context required)
    const { error } = await supabase
      .from("batches")
      .update({ status: next.status, updated_at: next.updatedAt, archived: false })
      .eq("id", id);

    if (error) return { ok: false, error: error.message };
    return { ok: true, batch: next };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Unknown error" };
  }
}

// ─── WORKFLOW GUARDS ─────────────────────────────────────────────────────────
function isLocked(b: Batch): boolean {
  return !!b.locked || b.status === "In Transit" || b.status === "Completed";
}
function canConfirmShipment(b: Batch): boolean {
  return b.batchType === "outbound" && b.status === "Created" && !isLocked(b);
}

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

      // 1) Try encoded payload first (instant render)
      const okEncoded = setFromEncoded();

      // 2) If Supabase configured, fetch live record so confirm receipt works
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
        // No Supabase; if encoded failed, we can’t do anything.
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
                  This receipt page is running on a different device. Without Supabase (or another database), it cannot update the sender’s system.
                  Enable Supabase to make “Confirm Receipt” update the batch instantly.
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
function AuthScreen({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup" | "invite">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignIn = async () => {
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else onAuth();
    setLoading(false);
  };

  const handleSignUp = async () => {
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }
    setLoading(true);
    setError("");

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (!authData.user) {
      setError("Signup failed");
      setLoading(false);
      return;
    }

    // Create company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .insert({ name: companyName })
      .select()
      .single();

    if (companyError) {
      setError(companyError.message);
      setLoading(false);
      return;
    }

    // Create membership
    const { error: memberError } = await supabase.from("company_memberships").insert({
      user_id: authData.user.id,
      company_id: company.id,
      role: "admin",
    });

    if (memberError) {
      setError(memberError.message);
      setLoading(false);
      return;
    }

    onAuth();
    setLoading(false);
  };

  const handleInvite = async () => {
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }
    setLoading(true);
    setError("");

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (!authData.user) {
      setError("Signup failed");
      setLoading(false);
      return;
    }

    const { error: memberError } = await supabase.from("company_memberships").insert({
      user_id: authData.user.id,
      company_id: inviteCode,
      role: "member",
    });

    if (memberError) {
      setError(memberError.message);
      setLoading(false);
      return;
    }

    onAuth();
    setLoading(false);
  };

  const S = {
    screen: {
      minHeight: "100vh",
      background: "#080D14",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
    },
    card: {
      maxWidth: 440,
      width: "100%",
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 16,
      padding: 32,
    },
    logo: { height: 56, marginBottom: 24, borderRadius: 10 },
    h1: { fontSize: 24, fontWeight: 900, color: "#E8EDF5", marginBottom: 8 },
    p: { fontSize: 14, color: "rgba(232,237,245,0.6)", marginBottom: 24 },
    input: {
      width: "100%",
      background: "rgba(15,23,42,0.6)",
      border: "1px solid rgba(255,255,255,0.08)",
      color: "#E8EDF5",
      borderRadius: 10,
      padding: "11px 14px",
      fontSize: 14,
      marginBottom: 12,
      boxSizing: "border-box" as const,
    },
    btn: {
      width: "100%",
      background: "rgba(249,115,22,0.2)",
      border: "1px solid rgba(249,115,22,0.4)",
      color: "#F97316",
      borderRadius: 10,
      padding: "12px",
      fontSize: 14,
      fontWeight: 700,
      cursor: "pointer",
      marginBottom: 12,
    },
    error: {
      background: "rgba(239,68,68,0.15)",
      border: "1px solid rgba(239,68,68,0.3)",
      color: "#EF4444",
      padding: "10px 14px",
      borderRadius: 8,
      fontSize: 13,
      marginBottom: 12,
    },
    tabs: { display: "flex", gap: 8, marginBottom: 20 },
    tab: {
      flex: 1,
      padding: "8px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 600,
      color: "#E8EDF5",
      cursor: "pointer",
    },
    tabActive: {
      background: "rgba(249,115,22,0.12)",
      borderColor: "rgba(249,115,22,0.5)",
      color: "#F97316",
    },
  };

  return (
    <div style={S.screen}>
      <div style={S.card}>
        <img src={LOGO_URL} alt="Batch ID Pro" style={S.logo} />
        <h1 style={S.h1}>{APP_NAME}</h1>
        <p style={S.p}>Sign in to your company account</p>

        <div style={S.tabs}>
          <button style={{ ...S.tab, ...(mode === "signin" ? S.tabActive : {}) }} onClick={() => setMode("signin")}>
            Sign In
          </button>
          <button style={{ ...S.tab, ...(mode === "signup" ? S.tabActive : {}) }} onClick={() => setMode("signup")}>
            New Company
          </button>
          <button style={{ ...S.tab, ...(mode === "invite" ? S.tabActive : {}) }} onClick={() => setMode("invite")}>
            Join Company
          </button>
        </div>

        {error && <div style={S.error}>{error}</div>}

        {mode === "signin" && (
          <>
            <input type="email" placeholder="Email" style={S.input} value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              type="password"
              placeholder="Password"
              style={S.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
            />
            <button style={S.btn} onClick={handleSignIn} disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </>
        )}

        {mode === "signup" && (
          <>
            <input type="text" placeholder="Your Full Name" style={S.input} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <input type="text" placeholder="Company Name" style={S.input} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            <input type="email" placeholder="Email" style={S.input} value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              type="password"
              placeholder="Password (min 6 characters)"
              style={S.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button style={S.btn} onClick={handleSignUp} disabled={loading}>
              {loading ? "Creating account..." : "Create Company Account"}
            </button>
          </>
        )}

        {mode === "invite" && (
          <>
            <input type="text" placeholder="Your Full Name" style={S.input} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <input type="email" placeholder="Email" style={S.input} value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              type="password"
              placeholder="Password (min 6 characters)"
              style={S.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              type="text"
              placeholder="Company ID (from invite)"
              style={S.input}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
            <button style={S.btn} onClick={handleInvite} disabled={loading}>
              {loading ? "Joining..." : "Join Company"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CompanySelector({
  companies,
  onSelect,
}: {
  companies: { id: string; name: string }[];
  onSelect: (companyId: string) => void;
}) {
  const S = {
    screen: { minHeight: "100vh", display: "grid", placeItems: "center", background: "#080D14", color: "#E8EDF5", padding: 20 },
    card: {
      width: "min(520px, 92vw)",
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 16,
      padding: 28,
    },
    h1: { fontSize: 20, fontWeight: 900, marginBottom: 14 },
    btn: {
      width: "100%",
      textAlign: "left" as const,
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12,
      padding: "12px 14px",
      color: "#E8EDF5",
      cursor: "pointer",
      marginBottom: 10,
      fontWeight: 700,
    },
    sub: { opacity: 0.7, fontSize: 12, marginTop: 6 },
  };

  return (
    <div style={S.screen}>
      <div style={S.card}>
        <h1 style={S.h1}>Select a company</h1>
        <div style={S.sub}>You belong to {companies.length} companies.</div>
        <div style={{ height: 14 }} />
        {companies.map((c) => (
          <button key={c.id} style={S.btn} onClick={() => onSelect(c.id)}>
            {c.name}
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>{c.id}</div>
          </button>
        ))}
      </div>
    </div>
  );
}



export default function App() {
  // ── Receipt route detection ──
  // QR codes encode: https://batch.coresystemsni.com/?receipt=ID&d=ENCODED
  // If ?receipt= is present, render receipt page (external docket).
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const receiptId = params.get("receipt");
    const encoded = params.get("d");
    if (receiptId) return <PublicReceipt receiptId={receiptId} encoded={encoded} />;
  }

  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(!!supabase);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  // Supabase auth listener
  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess ?? null);
      setUser(sess?.user ?? null);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  // Load user's companies
  useEffect(() => {
    if (!supabase) return;
    if (!user) {
      setCompanies([]);
      setSelectedCompanyId(null);
      return;
    }

    (async () => {
      const { data: memberships, error } = await supabase
        .from("company_memberships")
        .select("company_id, companies(id, name)")
        .eq("user_id", user.id);

      if (error) {
        console.error("Error loading memberships:", error);
        setCompanies([]);
        setSelectedCompanyId(null);
        return;
      }

      const companyList = (memberships || [])
        .map((m: any) => m.companies)
        .filter(Boolean);

      setCompanies(companyList);

      if (companyList.length === 1) setSelectedCompanyId(companyList[0].id);
    })();
  }, [user]);

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#080D14", color: "white" }}>
        Loading...
      </div>
    );
  }

  if (supabase && !user) {
    return <AuthScreen onAuth={() => window.location.reload()} />;
  }

  if (supabase && companies.length > 1 && !selectedCompanyId) {
    return <CompanySelector companies={companies} onSelect={setSelectedCompanyId} />;
  }

  if (supabase && !selectedCompanyId) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#080D14", color: "white" }}>
        <div>No companies found. Contact your administrator.</div>
      </div>
    );
  }

  // Local fallback "session" (only when Supabase is not configured)
  const [localSession, setLocalSession] = useState(() => lsGet(LOCAL_SESSION_KEY) || "ok");
  useEffect(() => {
    if (!supabase) lsSet(LOCAL_SESSION_KEY, localSession || "ok");
  }, [localSession]);

  const activeCompanyId = supabase ? (selectedCompanyId as string) : "local";

  const [view, setView] = useState<View>("dashboard");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const [batches, setBatches] = useState<Batch[]>(() => (supabase ? [] : loadBatchesLocal()));

  // Persist local batches when running without Supabase
  useEffect(() => {
    if (supabase) return;
    saveBatchesLocal(batches);
  }, [batches]);

    // Load batches for active company (Supabase mode)
  useEffect(() => {
    if (!supabase) return;
    if (!activeCompanyId) return;
    loadBatches(activeCompanyId).then(setBatches);
  }, [activeCompanyId]);

const [speciesLibrary, setSpeciesLibrary] = useState<string[]>(() => lsJson(SPECIES_KEY, DEFAULT_SPECIES));
  const [companyLibrary, setCompanyLibrary] = useState<string[]>(() => lsJson(COMPANY_KEY, DEFAULT_COMPANIES));

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [batchTab, setBatchTab] = useState<BatchStatus>("Created");

  // Persist local batches
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

  // Optional: Pull latest from Supabase at startup (keeps local in sync)
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
      // Supabase-first
      if (supabase) {
        const now = new Date().toISOString();
        const toSave: Batch = { ...b, createdAt: b.createdAt || now, updatedAt: now };
        const r = await sbUpsertBatch(activeCompanyId, toSave);
        if (!r.ok) {
          addToast("error", r.error || "Supabase save failed");
          return;
        }
        addToast("success", "Docket created");
        const fresh = await loadBatches(activeCompanyId);
        setBatches(fresh);
        return;
      }

      // Local fallback
      setBatches((p) => [b, ...p]);
      addToast("success", "Docket created");
    },
    [addToast, activeCompanyId]
  );

  const updateBatch = useCallback(
    async (id: string, updates: Partial<Batch>) => {
      // Supabase-first
      if (supabase) {
        const current = batches.find((x) => x.id === id);
        const merged = current ? ({ ...current, ...updates, updatedAt: nowISO() } as Batch) : null;
        if (!merged) return;

        const r = await sbUpsertBatch(activeCompanyId, merged);
        if (!r.ok) {
          addToast("error", r.error || "Supabase update failed");
          return;
        }

        const fresh = await loadBatches(activeCompanyId);
        setBatches(fresh);
        return;
      }

      // Local fallback
      setBatches((p) => p.map((b) => (b.id === id ? { ...b, ...updates, updatedAt: nowISO() } : b)));
    },
    [addToast, batches, activeCompanyId]
  );

  const deleteBatch = useCallback(
    async (id: string) => {
      const b = batches.find((x) => x.id === id);
      if (b && isLocked(b)) {
        addToast("error", "This batch is locked and cannot be deleted.");
        return;
      }

      // Supabase-first
      if (supabase) {
        const { error } = await supabase.from("batches").delete().eq("id", id).eq("company_id", activeCompanyId);
        if (error) {
          addToast("error", error.message);
          return;
        }
        addToast("info", "Deleted");
        const fresh = await loadBatches(activeCompanyId);
        setBatches(fresh);
        setView("batches");
        return;
      }

      // Local fallback
      setBatches((p) => p.filter((x) => x.id !== id));
      setView("batches");
      addToast("info", "Deleted");
    },
    [addToast, batches, activeCompanyId]
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
        const wasSent = !!b.sentAt || ["In Transit", "Completed"].includes(b.status as unknown as string);
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

  // Tabs and filters
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

  // LOGOUT
  const doLogout = useCallback(async () => {
    setSelectedBatchId(null);
    setView("dashboard");

    if (supabase) {
      await supabase.auth.signOut();
      return;
    }

    // local-only logout just resets “session”
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

// ─── TOAST ────────────────────────────────────────────────────────────────────


function ToastBar({ toasts }: { toasts: Toast[] }) {
  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 1000, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            padding: "10px 16px",
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 700,
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.1)",
            background: t.type === "success" ? "rgba(34,197,94,0.2)" : t.type === "error" ? "rgba(239,68,68,0.2)" : "rgba(59,130,246,0.2)",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── HEADER ───────────────────────────────────────────────────────────────────
function Header({ view, setView, closeBatch, stats, onLogout, showLogout }: any) {
  const nav = (v: View) => {
    closeBatch();
    setView(v);
  };
  return (
    <div style={S.header}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <img src={LOGO_URL} alt={APP_NAME} style={{ height: 52, borderRadius: 10, objectFit: "contain" }} />
      </div>

      <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center" }}>
        {(
          [
            ["dashboard", "Dashboard"],
            ["batches", `Batches (${stats.total})`],
            ["inbound", "Create Inbound"],
            ["outbound", "Outbound (Sent)"],
            ["eow", `EOW (${stats.completed})`],
            ["archive", `Archive (${stats.archived})`],
            ["species", "Species"],
            ["companies", "Companies"],
            ["settings", "Settings"],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button key={v} style={{ ...S.navBtn, ...(view === v ? S.navBtnActive : {}) }} onClick={() => nav(v)}>
            {label}
          </button>
        ))}

        {showLogout && (
          <button style={{ ...S.navBtn, ...S.navBtnActive, marginLeft: 6 }} onClick={onLogout}>
            Logout
          </button>
        )}
      </nav>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ stats, setView }: any) {
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 20 }}>Dashboard</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {[
          ["Active Batches", stats.total],
          ["Inbound", stats.inbound],
          ["Outbound", stats.outbound],
          ["Completed (EOW)", stats.completed],
        ].map(([label, val]) => (
          <div key={label as string} style={S.tile}>
            <div style={S.tileLabel}>{label}</div>
            <div style={S.tileValue}>{val}</div>
          </div>
        ))}
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 12, opacity: 0.7 }}>Quick Actions</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {(
          [
            ["inbound", "📥", "Create Inbound", "New incoming docket"],
            ["outbound", "📤", "Outbound (Sent)", "What you've shipped"],
            ["batches", "📋", "All Batches", "View draft + in transit"],
            ["eow", "📊", "End of Week", "Weekly reports"],
          ] as [View, string, string, string][]
        ).map(([v, icon, title, sub]) => (
          <button key={v} style={S.actionTile} onClick={() => setView(v)}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{title}</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── BATCHES VIEW (Created/In Transit) ───────────────────────────────────────
function BatchesView({ batches, tab, setTab, openBatch, deleteBatch }: any) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900 }}>Batches</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {(["Created", "In Transit"] as BatchStatus[]).map((t) => (
            <button key={t} style={{ ...S.tabBtn, ...(tab === t ? S.tabBtnActive : {}) }} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {batches.length === 0 ? (
        <div style={{ ...S.card, padding: 24, textAlign: "center" as const, opacity: 0.55 }}>No batches in this status</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
          {batches.map((b: Batch) => (
            <div
              key={b.id}
              style={{ ...S.card, ...S.cardPad, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              onClick={() => openBatch(b.id)}
            >
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <span style={{ ...S.typeBadge(b.batchType) }}>{cap(b.batchType)}</span>
                  <span style={{ ...S.statusBadge(b.status) }}>{b.status}</span>
                  {!!b.locked && <span style={{ ...S.statusBadge("In Transit" as any) }}>Locked</span>}
                  <span style={{ fontSize: 11, fontFamily: "monospace", opacity: 0.5 }}>{b.id}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {b.fromCompany} → {b.toCompany}
                </div>
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                  {speciesSummary(b)} · {totalKg(b)} kg · {fmtDate(b.orderDate)}
                </div>
              </div>

              <button
                style={{ ...S.btn, ...S.btnDanger, fontSize: 11, padding: "4px 10px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBatch(b.id);
                }}
                disabled={isLocked(b)}
                title={isLocked(b) ? "Locked batches cannot be deleted" : "Delete"}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OUTBOUND SENT VIEW ───────────────────────────────────────────────────────
function OutboundSentView({ batches, openBatch }: any) {
  const outbound = (batches as Batch[]).filter((b) => b.batchType === "outbound" && !b.archived);
  const sent = outbound.filter((b) => b.status === "In Transit" || b.status === "Completed");

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Outbound (Sent)</h2>
      <p style={{ ...S.small, opacity: 0.6, marginBottom: 18 }}>
        Only batches that have been confirmed as sent. Draft outbound dockets stay under <b>Batches → Created</b>.
      </p>

      {sent.length === 0 ? (
        <div style={{ ...S.card, padding: 24, textAlign: "center" as const, opacity: 0.55 }}>No outbound shipments yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
          {sent.map((b: Batch) => (
            <div key={b.id} style={{ ...S.card, ...S.cardPad, cursor: "pointer" }} onClick={() => openBatch(b.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span style={S.typeBadge(b.batchType)}>{cap(b.batchType)}</span>
                    <span style={S.statusBadge(b.status)}>{b.status}</span>
                    <span style={{ fontSize: 11, fontFamily: "monospace", opacity: 0.5 }}>{b.id}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>
                    {b.fromCompany} → {b.toCompany}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                    {speciesSummary(b)} · {totalKg(b)} kg · Sent: {b.sentAt ? fmtDT(b.sentAt) : "—"}
                  </div>
                </div>
                <div style={{ opacity: 0.7, fontSize: 12, fontWeight: 700 }}>{b.status === "Completed" ? "Delivered" : "Awaiting recipient"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CREATE DOCKET ────────────────────────────────────────────────────────────
function CreateDocketView({ batchType, createBatch, speciesLibrary, companyLibrary, addToast, setView }: any) {
  const isInbound = batchType === "inbound";
  const ourCompany = lsGet(OUR_COMPANY_KEY);

  const [fromCompany, setFromCompany] = useState(isInbound ? "" : ourCompany);
  const [toCompany, setToCompany] = useState(isInbound ? ourCompany : "");
  const [vesselRef, setVesselRef] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [lotRef, setLotRef] = useState("");
  const [notes, setNotes] = useState("");

  const [landingPort, setLandingPort] = useState("");
  const [processingPlant, setProcessingPlant] = useState("");
  const [catchCertNo, setCatchCertNo] = useState("");
  const [landingCertNo, setLandingCertNo] = useState("");
  const [processingCertNo, setProcessingCertNo] = useState("");
  const [healthCertNo, setHealthCertNo] = useState("");

  const [speciesLines, setSpeciesLines] = useState<SpeciesLine[]>([{ species: "", weightKg: 0 }]);
  const [showCompliance, setShowCompliance] = useState(false);

  const addSpecies = () => setSpeciesLines((p: SpeciesLine[]) => [...p, { species: "", weightKg: 0 }]);
  const removeSpecies = (i: number) => setSpeciesLines((p: SpeciesLine[]) => p.filter((_, idx) => idx !== i));
  const updateSpecies = (i: number, f: keyof SpeciesLine, v: any) =>
    setSpeciesLines((p: SpeciesLine[]) => p.map((l, idx) => (idx === i ? { ...l, [f]: v } : l)));

  const totalWeight = round2(speciesLines.reduce((a, l) => a + (+l.weightKg || 0), 0));

  const handleCreate = () => {
    if (!fromCompany || !toCompany) {
      addToast("error", "From and To company are required");
      return;
    }
    if (!speciesLines.some((l) => l.species)) {
      addToast("error", "Add at least one species");
      return;
    }

    const batch: Batch = {
      id: uid(),
      batchType,
      status: "Created",
      createdAt: nowISO(),
      updatedAt: nowISO(),
      fromCompany,
      toCompany,
      vesselRef,
      orderDate,
      lotRef,
      notes,
      speciesLines: speciesLines.map((l) => ({ ...l, weightKg: Number(l.weightKg) })).filter((l) => l.species),
      transportLegs: [],
      landingPort,
      processingPlant,
      catchCertNo,
      landingCertNo,
      processingCertNo,
      healthCertNo,
      locked: false,
    };

    createBatch(batch);
    setView("batches");
  };

  return (
    <div style={S.card}>
      <div style={S.cardPad}>
        <h2 style={{ ...S.h2, marginBottom: 4 }}>Create {cap(batchType)} Docket</h2>
        <p style={{ ...S.small, marginBottom: 16, opacity: 0.6 }}>{isInbound ? "Supplier → Your Company" : "Your Company → Customer"}</p>
        <div style={S.divider} />

        <div style={S.formGrid}>
          <div>
            <label style={S.label}>{isInbound ? "From (Supplier) *" : "From (Your Company) *"}</label>
            <input list="co-list" style={S.input} value={fromCompany} onChange={(e) => setFromCompany(e.target.value)} placeholder="Company name" />
          </div>
          <div>
            <label style={S.label}>{isInbound ? "To (Your Company) *" : "To (Customer) *"}</label>
            <input list="co-list" style={S.input} value={toCompany} onChange={(e) => setToCompany(e.target.value)} placeholder="Company name" />
          </div>

          <datalist id="co-list">
            {[...new Set([...companyLibrary, ourCompany].filter(Boolean))].map((c: string) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <div>
            <label style={S.label}>{isInbound ? "Vessel / Supplier Ref" : "Vehicle / Dispatch Ref"}</label>
            <input style={S.input} value={vesselRef} onChange={(e) => setVesselRef(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label style={S.label}>Order Date</label>
            <input type="date" style={S.input} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Lot / Batch Ref</label>
            <input style={S.input} value={lotRef} onChange={(e) => setLotRef(e.target.value)} placeholder="e.g. LOT-001" />
          </div>
        </div>

        <div style={S.divider} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 900 }}>Species & Weights *</h3>
          <button style={{ ...S.btn, fontSize: 11, padding: "6px 10px" }} onClick={addSpecies}>
            + Add Species
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
          {speciesLines.map((line, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select style={{ ...S.select, flex: 2 }} value={line.species} onChange={(e) => updateSpecies(i, "species", e.target.value)}>
                <option value="">Select species</option>
                {speciesLibrary.map((s: string) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="number"
                style={{ ...S.input, flex: 1 }}
                value={Number.isFinite(Number(line.weightKg)) && Number(line.weightKg) !== 0 ? String(line.weightKg) : ""}
                onChange={(e) => updateSpecies(i, "weightKg", e.target.value)}
                placeholder="kg"
              />
              {speciesLines.length > 1 && (
                <button style={{ ...S.btn, ...S.btnDanger, padding: "6px 10px", fontSize: 11 }} onClick={() => removeSpecies(i)}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            background: "rgba(249,115,22,0.1)",
            border: "1px solid rgba(249,115,22,0.3)",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 900,
          }}
        >
          Total Weight: {totalWeight} kg
        </div>

        <div style={S.divider} />

        <button style={{ ...S.btn, ...S.btnSecondary, width: "100%", marginBottom: 12 }} onClick={() => setShowCompliance((p) => !p)}>
          {showCompliance ? "▲" : "▼"} Compliance / Traceability Fields (optional)
        </button>

        {showCompliance && (
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Landing Port</label>
              <input style={S.input} value={landingPort} onChange={(e) => setLandingPort(e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Processing Plant</label>
              <input style={S.input} value={processingPlant} onChange={(e) => setProcessingPlant(e.target.value)} />
            </div>

            <div>
              <label style={S.label}>Catch Certificate #</label>
              <input style={S.input} value={catchCertNo} onChange={(e) => setCatchCertNo(e.target.value)} placeholder="e.g. CATCH-123" />
            </div>
            <div>
              <label style={S.label}>Landing Certificate #</label>
              <input style={S.input} value={landingCertNo} onChange={(e) => setLandingCertNo(e.target.value)} placeholder="e.g. LAND-456" />
            </div>
            <div>
              <label style={S.label}>Processing Certificate #</label>
              <input style={S.input} value={processingCertNo} onChange={(e) => setProcessingCertNo(e.target.value)} placeholder="e.g. PROC-789" />
            </div>
            <div>
              <label style={S.label}>Health Certificate #</label>
              <input style={S.input} value={healthCertNo} onChange={(e) => setHealthCertNo(e.target.value)} placeholder="e.g. HEALTH-001" />
            </div>
          </div>
        )}

        <div>
          <label style={S.label}>Notes</label>
          <textarea style={{ ...S.input, minHeight: 70, resize: "vertical" as const }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div style={{ marginTop: 16 }}>
          <button style={{ ...S.btn, ...S.btnPrimary, width: "100%", fontSize: 15, padding: "14px", fontWeight: 900 }} onClick={handleCreate}>
            Create Docket (Draft)
          </button>
          <div style={{ ...S.small, marginTop: 10, opacity: 0.55 }}>
            Draft only. For outbound, you must <b>Confirm Shipment</b> inside the batch before it becomes “Sent / In Transit”.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BATCH DETAIL ─────────────────────────────────────────────────────────────
function BatchDetail({ batch, updateBatch, deleteBatch, archiveBatch, unarchiveBatch, closeBatch, addToast, speciesLibrary, companyLibrary }: any) {
  void speciesLibrary;

  const locked = isLocked(batch);

  const [landingCertNo, setLandingCertNo] = useState(batch.landingCertNo || "");
  const [processingCertNo, setProcessingCertNo] = useState(batch.processingCertNo || "");
  const [catchCertNo, setCatchCertNo] = useState(batch.catchCertNo || "");
  const [healthCertNo, setHealthCertNo] = useState(batch.healthCertNo || "");
  const [transportLegs, setTransportLegs] = useState<TransportLeg[]>(batch.transportLegs || []);

  useEffect(() => {
    setLandingCertNo(batch.landingCertNo || "");
    setProcessingCertNo(batch.processingCertNo || "");
    setCatchCertNo(batch.catchCertNo || "");
    setHealthCertNo(batch.healthCertNo || "");
    setTransportLegs(batch.transportLegs || []);
  }, [batch.id]);

  const saveCerts = () => {
    if (locked) {
      addToast("error", "This batch is locked. No changes allowed after shipment.");
      return;
    }
    updateBatch(batch.id, { landingCertNo, processingCertNo, catchCertNo, healthCertNo, transportLegs });
    addToast("success", "Saved");
  };

  const addLeg = () => {
    if (locked) return;
    setTransportLegs((p) => [...p, { transportCompany: "", vehicleReg: "", handoverTime: nowISO(), notes: "" }]);
  };
  const removeLeg = (i: number) => {
    if (locked) return;
    setTransportLegs((p) => p.filter((_, idx) => idx !== i));
  };
  const updateLeg = (i: number, f: keyof TransportLeg, v: string) => {
    if (locked) return;
    setTransportLegs((p) => p.map((l, idx) => (idx === i ? { ...l, [f]: v } : l)));
  };

  const encoded = encodeBatch({ ...batch, landingCertNo, processingCertNo, catchCertNo, healthCertNo, transportLegs });
  const publicUrl = `${RESOLVER_BASE}/?receipt=${batch.id}&d=${encoded}`;

  const confirmShipment = async () => {
    if (!canConfirmShipment(batch)) {
      addToast("error", "Shipment cannot be confirmed for this batch.");
      return;
    }
    // eslint-disable-next-line no-restricted-globals
    const ok = confirm(
      `CONFIRM SHIPMENT?\n\nThis will mark the batch as IN TRANSIT (SENT) and LOCK it.\nNo edits, no delete, no rollback.\n\nContinue?`
    );
    if (!ok) return;

    updateBatch(batch.id, {
      landingCertNo,
      processingCertNo,
      catchCertNo,
      healthCertNo,
      transportLegs,
      status: "In Transit",
      sentAt: nowISO(),
      locked: true,
    });
    addToast("success", "Shipment confirmed (In Transit / Sent)");
  };

  return (
    <div style={S.card}>
      <div style={S.cardPad}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" as const, gap: 10, marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <span style={S.typeBadge(batch.batchType)}>{cap(batch.batchType)}</span>
              <span style={S.statusBadge(batch.status)}>{batch.status}</span>
              {locked && <span style={{ ...S.statusBadge("In Transit" as any) }}>Locked</span>}
            </div>
            <h2 style={S.h2}>Batch {batch.id}</h2>
            <p style={{ ...S.small, marginTop: 2, opacity: 0.55 }}>
              Created {fmtDT(batch.createdAt)}
              {batch.sentAt ? ` · Sent ${fmtDT(batch.sentAt)}` : ""}
              {batch.receivedAt ? ` · Received ${fmtDT(batch.receivedAt)}` : ""}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
            {canConfirmShipment(batch) && (
              <button style={{ ...S.btn, ...S.btnPrimary, fontWeight: 900 }} onClick={confirmShipment}>
                Confirm Shipment (Sent)
              </button>
            )}

            {batch.status === "Completed" && !batch.archived && (
              <button
                style={{ ...S.btn, ...S.btnDanger }}
                onClick={() => {
                  archiveBatch(batch.id);
                  closeBatch();
                }}
              >
                Archive
              </button>
            )}

            {batch.archived && (
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => unarchiveBatch(batch.id)}>
                Unarchive
              </button>
            )}

            <button
              style={{ ...S.btn, ...S.btnDanger, opacity: locked ? 0.45 : 1 }}
              disabled={locked}
              onClick={() => {
                // eslint-disable-next-line no-restricted-globals
                if (confirm("Delete this batch?")) deleteBatch(batch.id);
              }}
              title={locked ? "Locked batches cannot be deleted" : "Delete"}
            >
              Delete
            </button>

            <button style={{ ...S.btn, ...S.btnSecondary }} onClick={closeBatch}>
              Close
            </button>
          </div>
        </div>

        {locked && batch.status === "In Transit" && (
          <div style={{ padding: "10px 12px", borderRadius: 12, marginBottom: 14, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", fontSize: 13, lineHeight: 1.5 }}>
            <b>Locked:</b> This batch has been confirmed as <b>Sent / In Transit</b>. The sender cannot change anything now. The recipient must confirm via the QR receipt to complete the chain.
          </div>
        )}

        <div style={S.divider} />

        <div style={{ ...S.formGrid, marginBottom: 16 }}>
          <KV label="From" value={batch.fromCompany} />
          <KV label="To" value={batch.toCompany} />
          <KV label="Vessel / Ref" value={batch.vesselRef} />
          <KV label="Order Date" value={fmtDate(batch.orderDate)} />
          <KV label="Lot Ref" value={batch.lotRef} />
          {batch.landingPort && <KV label="Landing Port" value={batch.landingPort} />}
          {batch.processingPlant && <KV label="Processing Plant" value={batch.processingPlant} />}
        </div>

        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 900, marginBottom: 10, opacity: 0.7, textTransform: "uppercase" as const, letterSpacing: 1 }}>Species & Weight</h3>
          {(batch.speciesLines || []).map((l: SpeciesLine, i: number) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 14 }}>
              <span>{l.species}</span>
              <span style={{ fontFamily: "monospace", color: "#F97316", fontWeight: 800 }}>{l.weightKg} kg</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 14, fontWeight: 900 }}>
            <span>Total</span>
            <span style={{ fontFamily: "monospace" }}>{totalKg(batch)} kg</span>
          </div>
        </div>

        <div style={S.divider} />

        <h3 style={{ fontSize: 13, fontWeight: 900, marginBottom: 12, opacity: 0.7, textTransform: "uppercase" as const, letterSpacing: 1 }}>
          Certification Numbers
        </h3>
        <div style={S.formGrid}>
          {(
            [
              ["Landing Cert No", landingCertNo, setLandingCertNo],
              ["Processing Cert No", processingCertNo, setProcessingCertNo],
              ["Catch Cert No", catchCertNo, setCatchCertNo],
              ["Health Cert No", healthCertNo, setHealthCertNo],
            ] as any[]
          ).map(([label, val, setter]) => (
            <div key={label as string}>
              <label style={S.label}>{label}</label>
              <input style={{ ...S.input, opacity: locked ? 0.6 : 1 }} value={val} onChange={(e) => setter(e.target.value)} placeholder="Enter cert number" disabled={locked} />
            </div>
          ))}
        </div>

        <div style={S.divider} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 900, opacity: 0.7, textTransform: "uppercase" as const, letterSpacing: 1 }}>Transport / Handover Logs</h3>
          <button style={{ ...S.btn, fontSize: 11, padding: "6px 10px", opacity: locked ? 0.5 : 1 }} onClick={addLeg} disabled={locked}>
            + Add Leg
          </button>
        </div>

        {transportLegs.length === 0 && <p style={{ ...S.small, opacity: 0.45, marginBottom: 16 }}>No transport legs added yet.</p>}

        {transportLegs.map((leg, i) => (
          <div key={i} style={{ ...S.subCard, marginBottom: 10, opacity: locked ? 0.75 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 800, opacity: 0.6 }}>Leg {i + 1}</span>
              <button style={{ ...S.btn, ...S.btnDanger, fontSize: 11, padding: "3px 8px", opacity: locked ? 0.5 : 1 }} onClick={() => removeLeg(i)} disabled={locked}>
                Remove
              </button>
            </div>

            <div style={S.formGrid}>
              <div>
                <label style={S.label}>Transport Company</label>
                <input list="co-list2" style={S.input} value={leg.transportCompany} onChange={(e) => updateLeg(i, "transportCompany", e.target.value)} disabled={locked} />
                <datalist id="co-list2">
                  {companyLibrary.map((c: string) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <label style={S.label}>Vehicle Reg</label>
                <input style={S.input} value={leg.vehicleReg} onChange={(e) => updateLeg(i, "vehicleReg", e.target.value)} disabled={locked} />
              </div>

              <div>
                <label style={S.label}>Handover Time</label>
                <input type="datetime-local" style={S.input} value={leg.handoverTime?.slice(0, 16) || ""} onChange={(e) => updateLeg(i, "handoverTime", e.target.value)} disabled={locked} />
              </div>

              <div>
                <label style={S.label}>Notes</label>
                <input style={S.input} value={leg.notes || ""} onChange={(e) => updateLeg(i, "notes", e.target.value)} disabled={locked} />
              </div>
            </div>
          </div>
        ))}

        <button style={{ ...S.btn, ...S.btnPrimary, width: "100%", marginBottom: 16, opacity: locked ? 0.55 : 1 }} onClick={saveCerts} disabled={locked}>
          Save Certs & Transport
        </button>

        <div style={S.divider} />

        {batch.notes && (
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 900, marginBottom: 8, opacity: 0.7, textTransform: "uppercase" as const, letterSpacing: 1 }}>Notes</h3>
            <p style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.85 }}>{batch.notes}</p>
          </div>
        )}

        <div style={S.divider} />

        <div>
          <h3 style={{ fontSize: 13, fontWeight: 900, marginBottom: 12, opacity: 0.7, textTransform: "uppercase" as const, letterSpacing: 1 }}>
            QR Code — Receipt
          </h3>
          <div style={{ background: "#fff", padding: 16, borderRadius: 12, display: "inline-block", marginBottom: 10 }}>
            <QRCodeSVG value={publicUrl} size={160} />
          </div>
          <p style={{ ...S.small, marginTop: 6 }}>Scan to view receipt on any device</p>
          <p style={{ ...S.small, marginTop: 4, opacity: 0.55, wordBreak: "break-all" as const, fontSize: 11 }}>{publicUrl}</p>
        </div>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div style={{ padding: "8px 10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, fontSize: 13 }}>
      <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{value}</div>
    </div>
  );
}

// ─── EOW VIEW ─────────────────────────────────────────────────────────────────
function EOWView({ batches, openBatch }: any) {
  const totalWeight = round2(batches.reduce((a: number, b: Batch) => a + totalKg(b), 0));
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 4 }}>End of Week</h2>
      <p style={{ ...S.small, opacity: 0.55, marginBottom: 20 }}>
        {batches.length} completed batches · {totalWeight} kg total
      </p>
      {batches.length === 0 ? (
        <div style={{ ...S.card, padding: 24, textAlign: "center" as const, opacity: 0.55 }}>No completed batches yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
          {batches.map((b: Batch) => (
            <div key={b.id} style={{ ...S.card, ...S.cardPad, cursor: "pointer" }} onClick={() => openBatch(b.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 2 }}>
                    {b.fromCompany} → {b.toCompany}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.55 }}>
                    {speciesSummary(b)} · {totalKg(b)} kg · {fmtDate(b.orderDate)}
                  </div>
                </div>
                <span style={S.typeBadge(b.batchType)}>{cap(b.batchType)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ARCHIVE VIEW ─────────────────────────────────────────────────────────────
function ArchiveView({ batches, openBatch, unarchiveBatch }: any) {
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 20 }}>Archive</h2>
      {batches.length === 0 ? (
        <div style={{ ...S.card, padding: 24, textAlign: "center" as const, opacity: 0.55 }}>No archived batches</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
          {batches.map((b: Batch) => (
            <div key={b.id} style={{ ...S.card, ...S.cardPad, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => openBatch(b.id)}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 2 }}>
                  {b.fromCompany} → {b.toCompany}
                </div>
                <div style={{ fontSize: 12, opacity: 0.55 }}>{speciesSummary(b)} · {totalKg(b)} kg</div>
              </div>
              <button
                style={{ ...S.btn, ...S.btnSecondary, fontSize: 11, padding: "4px 10px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  unarchiveBatch(b.id);
                }}
              >
                Unarchive
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LIBRARY VIEW ─────────────────────────────────────────────────────────────
function LibraryView({ title, items, setItems, addToast }: any) {
  const [newItem, setNewItem] = useState("");

  const add = () => {
    const v = newItem.trim();
    if (!v || items.includes(v)) {
      addToast("error", "Already exists or empty");
      return;
    }
    setItems([...items, v]);
    setNewItem("");
    addToast("success", "Added");
  };

  const remove = (item: string) => {
    setItems(items.filter((i: string) => i !== item));
    addToast("info", "Removed");
  };

  return (
    <div style={S.card}>
      <div style={S.cardPad}>
        <h2 style={{ ...S.h2, marginBottom: 16 }}>{title}</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add new..."
          />
          <button style={{ ...S.btn, ...S.btnPrimary, fontWeight: 900 }} onClick={add}>
            Add
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
          {items.map((item: string) => (
            <div
              key={item}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <span>{item}</span>
              <button style={{ ...S.btn, ...S.btnDanger, fontSize: 11, padding: "3px 8px" }} onClick={() => remove(item)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function SettingsView({ addToast }: any) {
  const [ourCompany, setOurCompany] = useState(lsGet(OUR_COMPANY_KEY));
  const save = () => {
    lsSet(OUR_COMPANY_KEY, ourCompany.trim());
    addToast("success", "Settings saved");
  };
  return (
    <div style={S.card}>
      <div style={S.cardPad}>
        <h2 style={{ ...S.h2, marginBottom: 16 }}>Settings</h2>

        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Your Company Name</label>
          <input style={S.input} value={ourCompany} onChange={(e) => setOurCompany(e.target.value)} placeholder="e.g. Portavogie Fish Co." />
          <p style={{ ...S.small, marginTop: 6, opacity: 0.55 }}>Used to auto-fill the "From" or "To" field when creating dockets.</p>
        </div>

        <div style={{ marginBottom: 16, padding: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, fontSize: 13 }}>
          <strong>Resolver URL:</strong>
          <br />
          <span style={{ fontFamily: "monospace", fontSize: 11, opacity: 0.7 }}>{RESOLVER_BASE}/?receipt=ID&d=ENCODED</span>
          <p style={{ marginTop: 6, opacity: 0.55, fontSize: 12 }}>QR codes point here. External “Confirm Receipt” requires Supabase configured.</p>
        </div>

        <div style={{ marginBottom: 16, padding: 12, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.18)", borderRadius: 10, fontSize: 13 }}>
          <strong>Supabase status:</strong>{" "}
          <span style={{ fontWeight: 900 }}>{SUPABASE_URL && SUPABASE_ANON ? "Configured ✅" : "Not configured (local-only) ⚠️"}</span>
          <div style={{ marginTop: 6, opacity: 0.65, fontSize: 12, lineHeight: 1.5 }}>
            If not configured, batches are localStorage only and external receipt confirmation cannot update your system.
          </div>
        </div>

        <button style={{ ...S.btn, ...S.btnPrimary, fontWeight: 900 }} onClick={save}>
          Save Settings
        </button>
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  app: { minHeight: "100vh", background: "#080D14", color: "#E8EDF5", fontFamily: "system-ui,sans-serif" },
  header: {
    background: "rgba(255,255,255,0.02)",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    padding: "12px 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap" as const,
    gap: 12,
  },
  container: { maxWidth: 1100, margin: "0 auto", padding: "24px 16px" },
  card: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 16,
    boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
  },
  cardPad: { padding: 20 },
  subCard: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 14 },
  divider: { height: 1, background: "rgba(255,255,255,0.06)", margin: "16px 0" },
  h2: { fontSize: 16, fontWeight: 900, letterSpacing: 0.2 },
  small: { fontSize: 12, lineHeight: 1.4 },
  label: { fontSize: 12, opacity: 0.75, marginBottom: 5, display: "block" as const },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 },
  input: {
    width: "100%",
    background: "rgba(15,23,42,0.6)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#E8EDF5",
    borderRadius: 10,
    padding: "9px 12px",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  select: {
    width: "100%",
    background: "rgba(15,23,42,0.6)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#E8EDF5",
    borderRadius: 10,
    padding: "9px 12px",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  btn: {
    cursor: "pointer",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#E8EDF5",
    borderRadius: 10,
    padding: "9px 14px",
    fontSize: 13,
    fontWeight: 700,
  },
  btnPrimary: { background: "rgba(249,115,22,0.2)", borderColor: "rgba(249,115,22,0.4)", color: "#F97316" },
  btnSecondary: { background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)" },
  btnDanger: { background: "rgba(239,68,68,0.15)", borderColor: "rgba(239,68,68,0.3)", color: "#EF4444" },
  navBtn: {
    cursor: "pointer",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    color: "#E8EDF5",
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 700,
  },
  navBtnActive: { borderColor: "rgba(249,115,22,0.5)", background: "rgba(249,115,22,0.12)", color: "#F97316" },
  tabBtn: {
    cursor: "pointer",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    color: "#E8EDF5",
    borderRadius: 20,
    padding: "7px 16px",
    fontSize: 12,
    fontWeight: 800,
  },
  tabBtnActive: { borderColor: "rgba(249,115,22,0.5)", background: "rgba(249,115,22,0.12)", color: "#F97316" },
  tile: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 16 },
  tileLabel: { fontSize: 12, opacity: 0.6, marginBottom: 8 },
  tileValue: { fontSize: 30, fontWeight: 900 },
  actionTile: {
    cursor: "pointer",
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    color: "#E8EDF5",
    borderRadius: 14,
    padding: 20,
    textAlign: "center" as const,
    width: "100%",
  },
  typeBadge: (t: BatchType) => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 900,
    background: t === "inbound" ? "rgba(59,130,246,0.15)" : "rgba(249,115,22,0.15)",
    color: t === "inbound" ? "#3B82F6" : "#F97316",
    border: `1px solid ${t === "inbound" ? "rgba(59,130,246,0.3)" : "rgba(249,115,22,0.3)"}`,
  }),
  statusBadge: (s: BatchStatus) => {
    const m: any = {
      Created: { bg: "rgba(59,130,246,0.15)", c: "#3B82F6", b: "rgba(59,130,246,0.3)" },
      "In Transit": { bg: "rgba(245,158,11,0.15)", c: "#F59E0B", b: "rgba(245,158,11,0.3)" },
      Completed: { bg: "rgba(34,197,94,0.15)", c: "#22C55E", b: "rgba(34,197,94,0.3)" },
      Archived: { bg: "rgba(148,163,184,0.1)", c: "#94A3B8", b: "rgba(148,163,184,0.2)" },
    };
    const x = m[s] || m.Created;
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 900,
      background: x.bg,
      color: x.c,
      border: `1px solid ${x.b}`,
    };
  },
};
