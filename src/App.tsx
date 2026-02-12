// Batch ID Pro — Fresh Build
// QR codes point to standalone resolver at batch-id-pro-mi3x.vercel.app/b/:id
// No hash routing, no BrowserRouter, no conflicts.

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";

// ─── RESOLVER URL ────────────────────────────────────────────────────────────
// Change this to your resolver domain once you have a custom domain
const RESOLVER_BASE = typeof window !== "undefined" ? window.location.origin : "https://batch-id-pro.vercel.app";

// ─── TYPES ───────────────────────────────────────────────────────────────────
type BatchType = "inbound" | "outbound";
type BatchStatus = "Created" | "In Transit" | "Completed" | "Archived";
type View = "dashboard" | "batches" | "batch" | "inbound" | "outbound" | "eow" | "archive" | "species" | "companies" | "settings";
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
}

// ─── STORAGE ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = "batchidpro_v1";
const OUR_COMPANY_KEY = "batchidpro_ourcompany";
const SPECIES_KEY = "batchidpro_species";
const COMPANY_KEY = "batchidpro_companies";

const DEFAULT_SPECIES = ["Cod","Haddock","Hake","Whiting","Monkfish","Scallops","Mackerel","Herring","Plaice","Sole","Nephrops (Prawns)","Pollock","Skate"];
const DEFAULT_COMPANIES = ["Portavogie Fish Co.","Ards Marine","Lough Catch Ltd","North Coast Supplies","Kilkeel Seafoods","Belfast Cold Store","McIlroy Logistics","NI Reefer Haulage","SeaChain Transport","ColdRun Ltd"];

function ls(key: string): string { try { return window.localStorage.getItem(key) || ""; } catch { return ""; } }
function lsSet(key: string, val: string) { try { window.localStorage.setItem(key, val); } catch {} }
function lsJson<T>(key: string, fallback: T): T { try { const v = ls(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }

function loadBatches(): Batch[] { return lsJson<Batch[]>(STORAGE_KEY, []); }
function saveBatches(b: Batch[]) { lsSet(STORAGE_KEY, JSON.stringify(b)); }

// ─── UTILS ───────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(16).slice(2,10).toUpperCase();
const nowISO = () => new Date().toISOString();
const fmtDate = (s: string) => { try { return new Date(s).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"2-digit"}); } catch { return s; } };
const fmtDT = (s: string) => { try { return new Date(s).toLocaleString(undefined,{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"}); } catch { return s; } };
const cap = (s: string) => s ? s[0].toUpperCase()+s.slice(1) : s;
const round2 = (n: number) => Math.round(n*100)/100;
const totalKg = (b: Batch) => round2((b.speciesLines||[]).reduce((a,l)=>a+(+l.weightKg||0),0));
const speciesSummary = (b: Batch) => { const lines = (b.speciesLines||[]).filter(l=>l.species); if(!lines.length) return "—"; return lines.length===1 ? lines[0].species : `${lines[0].species} +${lines.length-1}`; };

function encodeBatch(batch: Batch): string {
  try {
    const d = { id:batch.id, batchType:batch.batchType, status:batch.status, createdAt:batch.createdAt, fromCompany:batch.fromCompany, toCompany:batch.toCompany, vesselRef:batch.vesselRef, orderDate:batch.orderDate, lotRef:batch.lotRef, notes:batch.notes, speciesLines:batch.speciesLines, transportLegs:(batch.transportLegs||[]).map(l=>({transportCompany:l.transportCompany,vehicleReg:l.vehicleReg,handoverTime:l.handoverTime,notes:l.notes})), landingCertNo:batch.landingCertNo, processingCertNo:batch.processingCertNo, catchCertNo:batch.catchCertNo, healthCertNo:batch.healthCertNo, landingPort:batch.landingPort, processingPlant:batch.processingPlant };
    return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(d)))));
  } catch { return ""; }
}

// ─── LOGO / BRANDING ─────────────────────────────────────────────────────────
const LOGO_URL = "https://res.cloudinary.com/dmnuqcykq/image/upload/v1770027904/ChatGPT_Image_Feb_2_2026_10_24_54_AM_f99qva.png";
const APP_NAME = "Batch ID Pro";
const BRAND = "Powered by Core Systems NI";

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

// ─── PUBLIC RECEIPT PAGE ─────────────────────────────────────────────────────
function PublicReceipt({ batch }: { batch: any }) {
  const LOGO = "https://res.cloudinary.com/dmnuqcykq/image/upload/v1770027904/ChatGPT_Image_Feb_2_2026_10_24_54_AM_f99qva.png";
  const fmtD = (s: string) => { try { return new Date(s).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"2-digit"}); } catch { return s||"—"; }};
  const fmtDT = (s: string) => { try { return new Date(s).toLocaleString(undefined,{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"}); } catch { return s||"—"; }};
  const totalW = ((batch.speciesLines||[]).reduce((a:number,l:any)=>a+(+l.weightKg||0),0)).toFixed(2);
  const hasCerts = batch.landingCertNo||batch.processingCertNo||batch.catchCertNo||batch.healthCertNo;
  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#080D14;color:#E8EDF5;font-family:system-ui,sans-serif;min-height:100vh}
    .wrap{max-width:660px;margin:0 auto;padding:28px 16px 60px}
    .hdr{display:flex;align-items:center;gap:14px;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.07)}
    .hdr img{height:48px;border-radius:10px}
    .hdr h1{font-size:18px;font-weight:800}
    .bid{font-size:11px;font-family:monospace;opacity:0.5;margin-top:3px}
    .badge{display:inline-flex;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:700;margin-left:auto}
    .section{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:18px;margin-bottom:12px}
    .sec-label{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:0.5;margin-bottom:12px}
    .kv{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}
    .kv:last-child{border:none;padding-bottom:0}
    .kv-k{opacity:0.55}.kv-v{font-weight:600;text-align:right}
    .sp-row{display:flex;justify-content:space-between;padding:9px 12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:9px;margin-bottom:7px;font-size:13px}
    .sp-name{font-weight:600}.sp-w{font-family:monospace;color:#F97316}
    .total{display:flex;justify-content:space-between;padding-top:10px;margin-top:4px;border-top:1px solid rgba(255,255,255,0.07);font-size:14px;font-weight:800}
    .cert-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
    .cert{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:9px;padding:10px 12px}
    .cert-l{font-size:10px;opacity:0.5;margin-bottom:4px}.cert-v{font-family:monospace;font-size:13px;font-weight:700}
    .footer{text-align:center;font-size:11px;opacity:0.35;margin-top:36px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06)}
  `;
  const statusColor = (s:string) => s==="Completed"?"#22C55E":s==="In Transit"?"#F59E0B":"#3B82F6";
  const typeBg = (t:string) => t==="inbound"?"rgba(59,130,246,0.15)":"rgba(249,115,22,0.15)";
  const typeColor = (t:string) => t==="inbound"?"#3B82F6":"#F97316";

  return (
    <div>
      <style>{css}</style>
      <div className="wrap">
        <div className="hdr">
          <img src={LOGO} alt="Batch ID Pro" />
          <div>
            <h1>Batch Receipt <span style={{display:"inline-flex",padding:"3px 10px",borderRadius:999,fontSize:11,fontWeight:700,background:typeBg(batch.batchType),color:typeColor(batch.batchType),border:`1px solid ${typeColor(batch.batchType)}44`,marginLeft:8,verticalAlign:"middle"}}>{batch.batchType}</span></h1>
            <div className="bid">ID: {batch.id}</div>
          </div>
          <span className="badge" style={{background:`${statusColor(batch.status)}22`,color:statusColor(batch.status),border:`1px solid ${statusColor(batch.status)}55`}}>{batch.status}</span>
        </div>

        <div className="section">
          <div className="sec-label">Batch Details</div>
          {[["From",batch.fromCompany],["To",batch.toCompany],["Vessel / Ref",batch.vesselRef],["Order Date",fmtD(batch.orderDate)],["Lot Ref",batch.lotRef],["Created",fmtDT(batch.createdAt)],["Landing Port",batch.landingPort],["Processing Plant",batch.processingPlant]].filter(([,v])=>v).map(([k,v])=>(
            <div className="kv" key={k as string}><span className="kv-k">{k}</span><span className="kv-v">{v}</span></div>
          ))}
        </div>

        <div className="section">
          <div className="sec-label">Species & Weight</div>
          {(batch.speciesLines||[]).map((l:any,i:number)=>(
            <div className="sp-row" key={i}><span className="sp-name">{l.species}</span><span className="sp-w">{(+l.weightKg||0).toFixed(2)} kg</span></div>
          ))}
          <div className="total"><span>Total Weight</span><span>{totalW} kg</span></div>
        </div>

        {hasCerts && (
          <div className="section">
            <div className="sec-label">Certification Numbers</div>
            <div className="cert-grid">
              {[["Landing Cert",batch.landingCertNo],["Processing Cert",batch.processingCertNo],["Catch Cert",batch.catchCertNo],["Health Cert",batch.healthCertNo]].filter(([,v])=>v).map(([l,v])=>(
                <div className="cert" key={l as string}><div className="cert-l">{l}</div><div className="cert-v">{v}</div></div>
              ))}
            </div>
          </div>
        )}

        {(batch.transportLegs||[]).length>0 && (
          <div className="section">
            <div className="sec-label">Transport / Handover</div>
            {batch.transportLegs.map((leg:any,i:number)=>(
              <div key={i} style={{paddingBottom:10,marginBottom:10,borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                {[["Company",leg.transportCompany],["Vehicle Reg",leg.vehicleReg],["Handover",fmtDT(leg.handoverTime)],["Notes",leg.notes]].filter(([,v])=>v).map(([k,v])=>(
                  <div className="kv" key={k as string}><span className="kv-k">{k}</span><span className="kv-v">{v}</span></div>
                ))}
              </div>
            ))}
          </div>
        )}

        {batch.notes && (
          <div className="section">
            <div className="sec-label">Notes</div>
            <p style={{fontSize:13,lineHeight:1.6,opacity:0.8}}>{batch.notes}</p>
          </div>
        )}

        <div className="footer">Powered by Core Systems NI · Batch ID Pro</div>
      </div>
    </div>
  );
}

export default function App() {
  // ── Receipt route detection ──
  // If URL has ?receipt=ID&d=DATA, show public receipt page instead of app
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const receiptId = params.get("receipt");
    const encoded = params.get("d");
    if (receiptId && encoded) {
      try {
        const batch = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(encoded)))));
        if (batch && batch.id === receiptId) {
          return <PublicReceipt batch={batch} />;
        }
      } catch(e) { console.warn("Receipt decode failed", e); }
    }
  }

  const [view, setView] = useState<View>("dashboard");
  const [selectedBatchId, setSelectedBatchId] = useState<string|null>(null);
  const [batches, setBatches] = useState<Batch[]>(() => loadBatches());
  const [speciesLibrary, setSpeciesLibrary] = useState<string[]>(() => lsJson(SPECIES_KEY, DEFAULT_SPECIES));
  const [companyLibrary, setCompanyLibrary] = useState<string[]>(() => lsJson(COMPANY_KEY, DEFAULT_COMPANIES));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [batchTab, setBatchTab] = useState<BatchStatus>("Created");

  useEffect(() => { saveBatches(batches); }, [batches]);
  useEffect(() => { lsSet(SPECIES_KEY, JSON.stringify(speciesLibrary)); }, [speciesLibrary]);
  useEffect(() => { lsSet(COMPANY_KEY, JSON.stringify(companyLibrary)); }, [companyLibrary]);

  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = uid();
    setToasts(p=>[...p,{id,type,message}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),3000);
  },[]);

  const createBatch = useCallback((b: Batch) => { setBatches(p=>[b,...p]); addToast("success","Docket created"); },[addToast]);
  const updateBatch = useCallback((id: string, updates: Partial<Batch>) => { setBatches(p=>p.map(b=>b.id===id?{...b,...updates,updatedAt:nowISO()}:b)); },[]);
  const deleteBatch = useCallback((id: string) => { setBatches(p=>p.filter(b=>b.id!==id)); setView("batches"); addToast("info","Deleted"); },[addToast]);
  const archiveBatch = useCallback((id: string) => { updateBatch(id,{archived:true,status:"Archived"}); addToast("success","Archived"); },[updateBatch,addToast]);
  const unarchiveBatch = useCallback((id: string) => { updateBatch(id,{archived:false,status:"Created"}); addToast("success","Unarchived"); },[updateBatch,addToast]);
  const openBatch = useCallback((id: string) => { setSelectedBatchId(id); setView("batch"); },[]);
  const closeBatch = useCallback(() => { setSelectedBatchId(null); setView("batches"); },[]);

  const activeBatches = useMemo(()=>batches.filter(b=>!b.archived&&(b.status==="Created"||b.status==="In Transit")),[batches]);
  const completedBatches = useMemo(()=>batches.filter(b=>!b.archived&&b.status==="Completed"),[batches]);
  const archivedBatches = useMemo(()=>batches.filter(b=>b.archived),[batches]);
  const filteredBatches = useMemo(()=>activeBatches.filter(b=>b.status===batchTab),[activeBatches,batchTab]);
  const selectedBatch = selectedBatchId ? batches.find(b=>b.id===selectedBatchId)||null : null;

  const stats = useMemo(()=>({
    total: activeBatches.length,
    inbound: activeBatches.filter(b=>b.batchType==="inbound").length,
    outbound: activeBatches.filter(b=>b.batchType==="outbound").length,
    completed: completedBatches.length,
    archived: archivedBatches.length,
  }),[activeBatches,completedBatches,archivedBatches]);

  return (
    <div style={S.app}>
      <ToastBar toasts={toasts} />
      <Header view={view} setView={setView} closeBatch={closeBatch} stats={stats} />
      <div style={S.container}>
        {view==="dashboard" && <Dashboard stats={stats} setView={setView} />}
        {view==="batches" && <BatchesView batches={filteredBatches} tab={batchTab} setTab={setBatchTab} openBatch={openBatch} deleteBatch={deleteBatch} />}
        {view==="inbound" && <CreateDocketView batchType="inbound" createBatch={createBatch} speciesLibrary={speciesLibrary} companyLibrary={companyLibrary} addToast={addToast} setView={setView} />}
        {view==="outbound" && <CreateDocketView batchType="outbound" createBatch={createBatch} speciesLibrary={speciesLibrary} companyLibrary={companyLibrary} addToast={addToast} setView={setView} />}
        {view==="batch" && selectedBatch && <BatchDetail batch={selectedBatch} updateBatch={updateBatch} deleteBatch={deleteBatch} archiveBatch={archiveBatch} unarchiveBatch={unarchiveBatch} closeBatch={closeBatch} addToast={addToast} speciesLibrary={speciesLibrary} companyLibrary={companyLibrary} />}
        {view==="batch" && !selectedBatch && <div style={{padding:32}}><h2>Batch not found</h2><button style={{...S.btn,...S.btnSecondary,marginTop:16}} onClick={()=>setView("dashboard")}>Back to Dashboard</button></div>}
        {view==="eow" && <EOWView batches={completedBatches} openBatch={openBatch} />}
        {view==="archive" && <ArchiveView batches={archivedBatches} openBatch={openBatch} unarchiveBatch={unarchiveBatch} />}
        {view==="species" && <LibraryView title="Species Library" items={speciesLibrary} setItems={setSpeciesLibrary} addToast={addToast} />}
        {view==="companies" && <LibraryView title="Company Library" items={companyLibrary} setItems={setCompanyLibrary} addToast={addToast} />}
        {view==="settings" && <SettingsView addToast={addToast} />}
      </div>
    </div>
  );
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function ToastBar({toasts}:{toasts:Toast[]}) {
  return (
    <div style={{position:"fixed",bottom:16,right:16,zIndex:1000,display:"flex",flexDirection:"column",gap:8}}>
      {toasts.map(t=>(
        <div key={t.id} style={{padding:"10px 16px",borderRadius:12,fontSize:13,fontWeight:600,backdropFilter:"blur(8px)",border:"1px solid rgba(255,255,255,0.1)",background:t.type==="success"?"rgba(34,197,94,0.2)":t.type==="error"?"rgba(239,68,68,0.2)":"rgba(59,130,246,0.2)"}}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── HEADER ───────────────────────────────────────────────────────────────────
function Header({view,setView,closeBatch,stats}:any) {
  const nav = (v: View) => { closeBatch(); setView(v); };
  return (
    <div style={S.header}>
      <div style={{display:"flex",alignItems:"center",gap:20}}>
        <img src={LOGO_URL} alt={APP_NAME} style={{height:56,borderRadius:10,objectFit:"contain"}} />
      </div>
      <nav style={{display:"flex",gap:6,flexWrap:"wrap" as const,alignItems:"center"}}>
        {([["dashboard","Dashboard"],["batches",`Batches (${stats.total})`],["inbound","Create Inbound"],["outbound","Create Outbound"],["eow",`EOW (${stats.completed})`],["archive",`Archive (${stats.archived})`],["species","Species"],["companies","Companies"],["settings","Settings"]] as [View,string][]).map(([v,label])=>(
          <button key={v} style={{...S.navBtn,...(view===v?S.navBtnActive:{})}} onClick={()=>nav(v)}>{label}</button>
        ))}
      </nav>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({stats,setView}:any) {
  return (
    <div>
      <h2 style={{fontSize:20,fontWeight:900,marginBottom:20}}>Dashboard</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        {[["Active Batches",stats.total],["Inbound",stats.inbound],["Outbound",stats.outbound],["Completed (EOW)",stats.completed]].map(([label,val])=>(
          <div key={label as string} style={S.tile}>
            <div style={S.tileLabel}>{label}</div>
            <div style={S.tileValue}>{val}</div>
          </div>
        ))}
      </div>
      <h3 style={{fontSize:14,fontWeight:700,marginBottom:12,opacity:0.7}}>Quick Actions</h3>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
        {([["inbound","📥","Create Inbound","New incoming docket"],["outbound","📤","Create Outbound","New outgoing docket"],["batches","📋","All Batches","View batch records"],["eow","📊","End of Week","Weekly reports"]] as [View,string,string,string][]).map(([v,icon,title,sub])=>(
          <button key={v} style={S.actionTile} onClick={()=>setView(v)}>
            <div style={{fontSize:28,marginBottom:8}}>{icon}</div>
            <div style={{fontWeight:700,fontSize:13}}>{title}</div>
            <div style={{fontSize:11,opacity:0.6,marginTop:4}}>{sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── BATCHES VIEW ─────────────────────────────────────────────────────────────
function BatchesView({batches,tab,setTab,openBatch,deleteBatch}:any) {
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h2 style={{fontSize:20,fontWeight:900}}>Batches</h2>
        <div style={{display:"flex",gap:8}}>
          {(["Created","In Transit"] as BatchStatus[]).map(t=>(
            <button key={t} style={{...S.tabBtn,...(tab===t?S.tabBtnActive:{})}} onClick={()=>setTab(t)}>{t}</button>
          ))}
        </div>
      </div>
      {batches.length===0 ? <div style={{...S.card,padding:24,textAlign:"center" as const,opacity:0.5}}>No batches in this status</div> : (
        <div style={{display:"flex",flexDirection:"column" as const,gap:10}}>
          {batches.map((b:Batch)=>(
            <div key={b.id} style={{...S.card,...S.cardPad,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>openBatch(b.id)}>
              <div>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
                  <span style={{...S.typeBadge(b.batchType)}}>{cap(b.batchType)}</span>
                  <span style={{...S.statusBadge(b.status)}}>{b.status}</span>
                  <span style={{fontSize:11,fontFamily:"monospace",opacity:0.5}}>{b.id}</span>
                </div>
                <div style={{fontSize:14,fontWeight:600}}>{b.fromCompany} → {b.toCompany}</div>
                <div style={{fontSize:12,opacity:0.6,marginTop:2}}>{speciesSummary(b)} · {totalKg(b)} kg · {fmtDate(b.orderDate)}</div>
              </div>
              <button style={{...S.btn,...S.btnDanger,fontSize:11,padding:"4px 10px"}} onClick={e=>{e.stopPropagation();deleteBatch(b.id);}}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CREATE DOCKET ────────────────────────────────────────────────────────────
function CreateDocketView({batchType,createBatch,speciesLibrary,companyLibrary,addToast,setView}:any) {
  const isInbound = batchType==="inbound";
  const ourCompany = ls(OUR_COMPANY_KEY);
  const [fromCompany,setFromCompany] = useState(isInbound?"":ourCompany);
  const [toCompany,setToCompany] = useState(isInbound?ourCompany:"");
  const [vesselRef,setVesselRef] = useState("");
  const [orderDate,setOrderDate] = useState(new Date().toISOString().slice(0,10));
  const [lotRef,setLotRef] = useState("");
  const [notes,setNotes] = useState("");
  const [landingPort,setLandingPort] = useState("");
  const [processingPlant,setProcessingPlant] = useState("");
  const [catchCertNo,setCatchCertNo] = useState("");
  const [landingCertNo,setLandingCertNo] = useState("");
  const [processingCertNo,setProcessingCertNo] = useState("");
  const [healthCertNo,setHealthCertNo] = useState("");
  const [speciesLines,setSpeciesLines] = useState<SpeciesLine[]>([{species:"",weightKg:0}]);
  const [showCompliance,setShowCompliance] = useState(false);

  const addSpecies = () => setSpeciesLines(p=>[...p,{species:"",weightKg:0}]);
  const removeSpecies = (i:number) => setSpeciesLines(p=>p.filter((_,idx)=>idx!==i));
  const updateSpecies = (i:number,f:keyof SpeciesLine,v:any) => setSpeciesLines(p=>p.map((l,idx)=>idx===i?{...l,[f]:v}:l));

  const totalWeight = round2(speciesLines.reduce((a,l)=>a+(+l.weightKg||0),0));

  const handleCreate = () => {
    if(!fromCompany||!toCompany) { addToast("error","From and To company are required"); return; }
    if(!speciesLines.some(l=>l.species)) { addToast("error","Add at least one species"); return; }
    const batch: Batch = {
      id: uid(), batchType, status:"Created", createdAt:nowISO(), updatedAt:nowISO(),
      fromCompany, toCompany, vesselRef, orderDate, lotRef, notes,
      speciesLines: speciesLines.filter(l=>l.species),
      transportLegs: [], landingPort, processingPlant,
      catchCertNo, landingCertNo, processingCertNo, healthCertNo,
    };
    createBatch(batch);
    setView("batches");
  };

  return (
    <div style={S.card}>
      <div style={S.cardPad}>
        <h2 style={{...S.h2,marginBottom:4}}>Create {cap(batchType)} Docket</h2>
        <p style={{...S.small,marginBottom:16,opacity:0.6}}>{isInbound?"Supplier → Your Company":"Your Company → Customer"}</p>
        <div style={S.divider} />

        <div style={S.formGrid}>
          <div>
            <label style={S.label}>{isInbound?"From (Supplier) *":"From (Your Company) *"}</label>
            <input list="co-list" style={S.input} value={fromCompany} onChange={e=>setFromCompany(e.target.value)} placeholder="Company name" />
          </div>
          <div>
            <label style={S.label}>{isInbound?"To (Your Company) *":"To (Customer) *"}</label>
            <input list="co-list" style={S.input} value={toCompany} onChange={e=>setToCompany(e.target.value)} placeholder="Company name" />
          </div>
          <datalist id="co-list">{[...new Set([...companyLibrary,ourCompany].filter(Boolean))].map((c:string)=><option key={c} value={c}/>)}</datalist>
          <div>
            <label style={S.label}>{isInbound?"Vessel / Supplier Ref":"Vehicle / Dispatch Ref"}</label>
            <input style={S.input} value={vesselRef} onChange={e=>setVesselRef(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label style={S.label}>Order Date</label>
            <input type="date" style={S.input} value={orderDate} onChange={e=>setOrderDate(e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Lot / Batch Ref</label>
            <input style={S.input} value={lotRef} onChange={e=>setLotRef(e.target.value)} placeholder="e.g. LOT-001" />
          </div>
        </div>

        <div style={S.divider} />

        {/* Species */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <h3 style={{fontSize:14,fontWeight:800}}>Species & Weights *</h3>
          <button style={{...S.btn,fontSize:11,padding:"6px 10px"}} onClick={addSpecies}>+ Add Species</button>
        </div>
        <div style={{display:"flex",flexDirection:"column" as const,gap:8}}>
          {speciesLines.map((line,i)=>(
            <div key={i} style={{display:"flex",gap:8,alignItems:"center"}}>
              <select style={{...S.select,flex:2}} value={line.species} onChange={e=>updateSpecies(i,"species",e.target.value)}>
                <option value="">Select species</option>
                {speciesLibrary.map((s:string)=><option key={s} value={s}>{s}</option>)}
              </select>
              <input type="number" style={{...S.input,flex:1}} value={line.weightKg||""} onChange={e=>updateSpecies(i,"weightKg",e.target.value)} placeholder="kg" />
              {speciesLines.length>1 && <button style={{...S.btn,...S.btnDanger,padding:"6px 10px",fontSize:11}} onClick={()=>removeSpecies(i)}>✕</button>}
            </div>
          ))}
        </div>
        <div style={{marginTop:10,padding:"10px 14px",background:"rgba(249,115,22,0.1)",border:"1px solid rgba(249,115,22,0.3)",borderRadius:10,fontSize:14,fontWeight:700}}>
          Total Weight: {totalWeight} kg
        </div>

        <div style={S.divider} />

        {/* Compliance toggle */}
        <button style={{...S.btn,...S.btnSecondary,width:"100%",marginBottom:12}} onClick={()=>setShowCompliance(p=>!p)}>
          {showCompliance?"▲":"▼"} Compliance / Traceability Fields (optional)
        </button>
        {showCompliance && (
          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Landing Port</label>
              <input style={S.input} value={landingPort} onChange={e=>setLandingPort(e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Processing Plant</label>
              <input style={S.input} value={processingPlant} onChange={e=>setProcessingPlant(e.target.value)} />
            </div>

            <div>
              <label style={S.label}>Catch Certificate #</label>
              <input style={S.input} value={catchCertNo} onChange={e=>setCatchCertNo(e.target.value)} placeholder="e.g. CATCH-123" />
            </div>
            <div>
              <label style={S.label}>Landing Certificate #</label>
              <input style={S.input} value={landingCertNo} onChange={e=>setLandingCertNo(e.target.value)} placeholder="e.g. LAND-456" />
            </div>
            <div>
              <label style={S.label}>Processing Certificate #</label>
              <input style={S.input} value={processingCertNo} onChange={e=>setProcessingCertNo(e.target.value)} placeholder="e.g. PROC-789" />
            </div>
            <div>
              <label style={S.label}>Health Certificate #</label>
              <input style={S.input} value={healthCertNo} onChange={e=>setHealthCertNo(e.target.value)} placeholder="e.g. HEALTH-001" />
            </div>
          </div>
        )}

        <div>
          <label style={S.label}>Notes</label>
          <textarea style={{...S.input,minHeight:70,resize:"vertical" as const}} value={notes} onChange={e=>setNotes(e.target.value)} />
        </div>

        <div style={{marginTop:16}}>
          <button style={{...S.btn,...S.btnPrimary,width:"100%",fontSize:15,padding:"14px"}} onClick={handleCreate}>
            Create Docket
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BATCH DETAIL ─────────────────────────────────────────────────────────────
function BatchDetail({batch,updateBatch,deleteBatch,archiveBatch,unarchiveBatch,closeBatch,addToast,speciesLibrary,companyLibrary}:any) {
  const [landingCertNo,setLandingCertNo] = useState(batch.landingCertNo||"");
  const [processingCertNo,setProcessingCertNo] = useState(batch.processingCertNo||"");
  const [catchCertNo,setCatchCertNo] = useState(batch.catchCertNo||"");
  const [healthCertNo,setHealthCertNo] = useState(batch.healthCertNo||"");
  const [transportLegs,setTransportLegs] = useState<TransportLeg[]>(batch.transportLegs||[]);

  const saveCerts = () => {
    updateBatch(batch.id,{landingCertNo,processingCertNo,catchCertNo,healthCertNo,transportLegs});
    addToast("success","Saved");
  };

  const addLeg = () => setTransportLegs(p=>[...p,{transportCompany:"",vehicleReg:"",handoverTime:nowISO(),notes:""}]);
  const removeLeg = (i:number) => setTransportLegs(p=>p.filter((_,idx)=>idx!==i));
  const updateLeg = (i:number,f:keyof TransportLeg,v:string) => setTransportLegs(p=>p.map((l,idx)=>idx===i?{...l,[f]:v}:l));

  const encoded = encodeBatch({...batch,landingCertNo,processingCertNo,catchCertNo,healthCertNo,transportLegs});
  const publicUrl = `${RESOLVER_BASE}/?receipt=${batch.id}&d=${encoded}`;

  return (
    <div style={S.card}>
      <div style={S.cardPad}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap" as const,gap:10,marginBottom:16}}>
          <div>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
              <span style={S.typeBadge(batch.batchType)}>{cap(batch.batchType)}</span>
              <span style={S.statusBadge(batch.status)}>{batch.status}</span>
            </div>
            <h2 style={S.h2}>Batch {batch.id}</h2>
            <p style={{...S.small,marginTop:2,opacity:0.5}}>Created {fmtDT(batch.createdAt)}</p>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap" as const}}>
            {batch.status==="Created"&&batch.batchType==="outbound" && <button style={{...S.btn,...S.btnPrimary}} onClick={()=>{updateBatch(batch.id,{status:"In Transit"});addToast("success","Marked In Transit");}}>Mark In Transit</button>}
            {(batch.status==="Created"||batch.status==="In Transit") && <button style={{...S.btn,...S.btnPrimary}} onClick={()=>{updateBatch(batch.id,{status:"Completed"});addToast("success","Completed");closeBatch();}}>Mark Complete</button>}
            {batch.status==="Completed"&&!batch.archived && <button style={{...S.btn,...S.btnDanger}} onClick={()=>{archiveBatch(batch.id);closeBatch();}}>Archive</button>}
            {batch.archived && <button style={{...S.btn,...S.btnSecondary}} onClick={()=>unarchiveBatch(batch.id)}>Unarchive</button>}
            <button style={{...S.btn,...S.btnDanger}} onClick={()=>{if(confirm("Delete this batch?"))deleteBatch(batch.id);}}>Delete</button>
            <button style={{...S.btn,...S.btnSecondary}} onClick={closeBatch}>Close</button>
          </div>
        </div>

        <div style={S.divider} />

        {/* Core Info */}
        <div style={{...S.formGrid,marginBottom:16}}>
          <KV label="From" value={batch.fromCompany} />
          <KV label="To" value={batch.toCompany} />
          <KV label="Vessel / Ref" value={batch.vesselRef} />
          <KV label="Order Date" value={fmtDate(batch.orderDate)} />
          <KV label="Lot Ref" value={batch.lotRef} />
          {batch.landingPort && <KV label="Landing Port" value={batch.landingPort} />}
          {batch.processingPlant && <KV label="Processing Plant" value={batch.processingPlant} />}
        </div>

        {/* Species */}
        <div style={{marginBottom:16}}>
          <h3 style={{fontSize:13,fontWeight:800,marginBottom:10,opacity:0.7,textTransform:"uppercase" as const,letterSpacing:1}}>Species & Weight</h3>
          {(batch.speciesLines||[]).map((l:SpeciesLine,i:number)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.05)",fontSize:14}}>
              <span>{l.species}</span>
              <span style={{fontFamily:"monospace",color:"#F97316"}}>{l.weightKg} kg</span>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",fontSize:14,fontWeight:700}}>
            <span>Total</span>
            <span style={{fontFamily:"monospace"}}>{totalKg(batch)} kg</span>
          </div>
        </div>

        <div style={S.divider} />

        {/* Certifications */}
        <h3 style={{fontSize:13,fontWeight:800,marginBottom:12,opacity:0.7,textTransform:"uppercase" as const,letterSpacing:1}}>Certification Numbers</h3>
        <div style={S.formGrid}>
          {[["Landing Cert No",landingCertNo,setLandingCertNo],["Processing Cert No",processingCertNo,setProcessingCertNo],["Catch Cert No",catchCertNo,setCatchCertNo],["Health Cert No",healthCertNo,setHealthCertNo]].map(([label,val,setter]:any)=>(
            <div key={label as string}>
              <label style={S.label}>{label}</label>
              <input style={S.input} value={val} onChange={e=>setter(e.target.value)} placeholder="Enter cert number" />
            </div>
          ))}
        </div>

        <div style={S.divider} />

        {/* Transport */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <h3 style={{fontSize:13,fontWeight:800,opacity:0.7,textTransform:"uppercase" as const,letterSpacing:1}}>Transport / Handover Logs</h3>
          <button style={{...S.btn,fontSize:11,padding:"6px 10px"}} onClick={addLeg}>+ Add Leg</button>
        </div>
        {transportLegs.length===0 && <p style={{...S.small,opacity:0.4,marginBottom:16}}>No transport legs added yet.</p>}
        {transportLegs.map((leg,i)=>(
          <div key={i} style={{...S.subCard,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:12,fontWeight:700,opacity:0.6}}>Leg {i+1}</span>
              <button style={{...S.btn,...S.btnDanger,fontSize:11,padding:"3px 8px"}} onClick={()=>removeLeg(i)}>Remove</button>
            </div>
            <div style={S.formGrid}>
              <div><label style={S.label}>Transport Company</label><input list="co-list2" style={S.input} value={leg.transportCompany} onChange={e=>updateLeg(i,"transportCompany",e.target.value)} /><datalist id="co-list2">{companyLibrary.map((c:string)=><option key={c} value={c}/>)}</datalist></div>
              <div><label style={S.label}>Vehicle Reg</label><input style={S.input} value={leg.vehicleReg} onChange={e=>updateLeg(i,"vehicleReg",e.target.value)} /></div>
              <div><label style={S.label}>Handover Time</label><input type="datetime-local" style={S.input} value={leg.handoverTime?.slice(0,16)||""} onChange={e=>updateLeg(i,"handoverTime",e.target.value)} /></div>
              <div><label style={S.label}>Notes</label><input style={S.input} value={leg.notes||""} onChange={e=>updateLeg(i,"notes",e.target.value)} /></div>
            </div>
          </div>
        ))}

        <button style={{...S.btn,...S.btnPrimary,width:"100%",marginBottom:16}} onClick={saveCerts}>Save Certs & Transport</button>

        <div style={S.divider} />

        {/* Notes */}
        {batch.notes && <div style={{marginBottom:16}}><h3 style={{fontSize:13,fontWeight:800,marginBottom:8,opacity:0.7,textTransform:"uppercase" as const,letterSpacing:1}}>Notes</h3><p style={{fontSize:13,lineHeight:1.6,opacity:0.8}}>{batch.notes}</p></div>}

        <div style={S.divider} />

        {/* QR Code */}
        <div>
          <h3 style={{fontSize:13,fontWeight:800,marginBottom:12,opacity:0.7,textTransform:"uppercase" as const,letterSpacing:1}}>QR Code — Receipt</h3>
          <div style={{background:"#fff",padding:16,borderRadius:12,display:"inline-block",marginBottom:10}}>
            <QRCodeSVG value={publicUrl} size={160} />
          </div>
          <p style={{...S.small,marginTop:6}}>Scan to view receipt on any device</p>
          <p style={{...S.small,marginTop:4,opacity:0.5,wordBreak:"break-all" as const,fontSize:11}}>{publicUrl}</p>
        </div>
      </div>
    </div>
  );
}

function KV({label,value}:{label:string,value:string}) {
  if(!value) return null;
  return (
    <div style={{padding:"8px 10px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:8,fontSize:13}}>
      <div style={{fontSize:11,opacity:0.5,marginBottom:3}}>{label}</div>
      <div style={{fontWeight:600}}>{value}</div>
    </div>
  );
}

// ─── EOW VIEW ─────────────────────────────────────────────────────────────────
function EOWView({batches,openBatch}:any) {
  const totalWeight = round2(batches.reduce((a:number,b:Batch)=>a+totalKg(b),0));
  return (
    <div>
      <h2 style={{fontSize:20,fontWeight:900,marginBottom:4}}>End of Week</h2>
      <p style={{...S.small,opacity:0.5,marginBottom:20}}>{batches.length} completed batches · {totalWeight} kg total</p>
      {batches.length===0 ? <div style={{...S.card,padding:24,textAlign:"center" as const,opacity:0.5}}>No completed batches yet</div> : (
        <div style={{display:"flex",flexDirection:"column" as const,gap:10}}>
          {batches.map((b:Batch)=>(
            <div key={b.id} style={{...S.card,...S.cardPad,cursor:"pointer"}} onClick={()=>openBatch(b.id)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,marginBottom:2}}>{b.fromCompany} → {b.toCompany}</div>
                  <div style={{fontSize:12,opacity:0.5}}>{speciesSummary(b)} · {totalKg(b)} kg · {fmtDate(b.orderDate)}</div>
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
function ArchiveView({batches,openBatch,unarchiveBatch}:any) {
  return (
    <div>
      <h2 style={{fontSize:20,fontWeight:900,marginBottom:20}}>Archive</h2>
      {batches.length===0 ? <div style={{...S.card,padding:24,textAlign:"center" as const,opacity:0.5}}>No archived batches</div> : (
        <div style={{display:"flex",flexDirection:"column" as const,gap:10}}>
          {batches.map((b:Batch)=>(
            <div key={b.id} style={{...S.card,...S.cardPad,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>openBatch(b.id)}>
              <div>
                <div style={{fontSize:14,fontWeight:600,marginBottom:2}}>{b.fromCompany} → {b.toCompany}</div>
                <div style={{fontSize:12,opacity:0.5}}>{speciesSummary(b)} · {totalKg(b)} kg</div>
              </div>
              <button style={{...S.btn,...S.btnSecondary,fontSize:11,padding:"4px 10px"}} onClick={e=>{e.stopPropagation();unarchiveBatch(b.id);}}>Unarchive</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LIBRARY VIEW (Species / Companies) ──────────────────────────────────────
function LibraryView({title,items,setItems,addToast}:any) {
  const [newItem,setNewItem] = useState("");
  const add = () => { const v=newItem.trim(); if(!v||items.includes(v)){addToast("error","Already exists or empty");return;} setItems([...items,v]); setNewItem(""); addToast("success","Added"); };
  const remove = (item:string) => { setItems(items.filter((i:string)=>i!==item)); addToast("info","Removed"); };
  return (
    <div style={S.card}>
      <div style={S.cardPad}>
        <h2 style={{...S.h2,marginBottom:16}}>{title}</h2>
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          <input style={{...S.input,flex:1}} value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="Add new..." />
          <button style={{...S.btn,...S.btnPrimary}} onClick={add}>Add</button>
        </div>
        <div style={{display:"flex",flexDirection:"column" as const,gap:6}}>
          {items.map((item:string)=>(
            <div key={item} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,fontSize:13}}>
              <span>{item}</span>
              <button style={{...S.btn,...S.btnDanger,fontSize:11,padding:"3px 8px"}} onClick={()=>remove(item)}>Remove</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function SettingsView({addToast}:any) {
  const [ourCompany,setOurCompany] = useState(ls(OUR_COMPANY_KEY));
  const save = () => { lsSet(OUR_COMPANY_KEY,ourCompany.trim()); addToast("success","Settings saved"); };
  return (
    <div style={S.card}>
      <div style={S.cardPad}>
        <h2 style={{...S.h2,marginBottom:16}}>Settings</h2>
        <div style={{marginBottom:16}}>
          <label style={S.label}>Your Company Name</label>
          <input style={S.input} value={ourCompany} onChange={e=>setOurCompany(e.target.value)} placeholder="e.g. Portavogie Fish Co." />
          <p style={{...S.small,marginTop:6,opacity:0.5}}>Used to auto-fill the "From" or "To" field when creating dockets.</p>
        </div>
        <div style={{marginBottom:16,padding:12,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,fontSize:13}}>
          <strong>Resolver URL:</strong><br/>
          <span style={{fontFamily:"monospace",fontSize:11,opacity:0.6}}>{RESOLVER_BASE}/b/:batchId</span><br/>
          <p style={{marginTop:6,opacity:0.5,fontSize:12}}>QR codes point here. Your resolver project must be deployed at this domain.</p>
        </div>
        <button style={{...S.btn,...S.btnPrimary}} onClick={save}>Save Settings</button>
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  app: { minHeight:"100vh", background:"#080D14", color:"#E8EDF5", fontFamily:"system-ui,sans-serif" },
  header: { background:"rgba(255,255,255,0.02)", borderBottom:"1px solid rgba(255,255,255,0.07)", padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap" as const, gap:12 },
  container: { maxWidth:1100, margin:"0 auto", padding:"24px 16px" },
  card: { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:16, boxShadow:"0 8px 32px rgba(0,0,0,0.3)" },
  cardPad: { padding:20 },
  subCard: { background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:14 },
  divider: { height:1, background:"rgba(255,255,255,0.06)", margin:"16px 0" },
  h2: { fontSize:16, fontWeight:900, letterSpacing:0.2 },
  small: { fontSize:12, lineHeight:1.4 },
  label: { fontSize:12, opacity:0.7, marginBottom:5, display:"block" as const },
  formGrid: { display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12 },
  input: { width:"100%", background:"rgba(15,23,42,0.6)", border:"1px solid rgba(255,255,255,0.08)", color:"#E8EDF5", borderRadius:10, padding:"9px 12px", fontSize:13, outline:"none", boxSizing:"border-box" as const },
  select: { width:"100%", background:"rgba(15,23,42,0.6)", border:"1px solid rgba(255,255,255,0.08)", color:"#E8EDF5", borderRadius:10, padding:"9px 12px", fontSize:13, outline:"none", boxSizing:"border-box" as const },
  btn: { cursor:"pointer", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", color:"#E8EDF5", borderRadius:10, padding:"9px 14px", fontSize:13, fontWeight:600 },
  btnPrimary: { background:"rgba(249,115,22,0.2)", borderColor:"rgba(249,115,22,0.4)", color:"#F97316" },
  btnSecondary: { background:"rgba(255,255,255,0.03)", borderColor:"rgba(255,255,255,0.1)" },
  btnDanger: { background:"rgba(239,68,68,0.15)", borderColor:"rgba(239,68,68,0.3)", color:"#EF4444" },
  navBtn: { cursor:"pointer", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", color:"#E8EDF5", borderRadius:8, padding:"7px 12px", fontSize:12, fontWeight:600 },
  navBtnActive: { borderColor:"rgba(249,115,22,0.5)", background:"rgba(249,115,22,0.12)", color:"#F97316" },
  tabBtn: { cursor:"pointer", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", color:"#E8EDF5", borderRadius:20, padding:"7px 16px", fontSize:12, fontWeight:600 },
  tabBtnActive: { borderColor:"rgba(249,115,22,0.5)", background:"rgba(249,115,22,0.12)", color:"#F97316" },
  tile: { background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:14, padding:16 },
  tileLabel: { fontSize:12, opacity:0.6, marginBottom:8 },
  tileValue: { fontSize:30, fontWeight:900 },
  actionTile: { cursor:"pointer", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", color:"#E8EDF5", borderRadius:14, padding:20, textAlign:"center" as const, width:"100%" },
  typeBadge: (t:BatchType) => ({ display:"inline-flex", alignItems:"center", padding:"3px 10px", borderRadius:999, fontSize:11, fontWeight:700, background:t==="inbound"?"rgba(59,130,246,0.15)":"rgba(249,115,22,0.15)", color:t==="inbound"?"#3B82F6":"#F97316", border:`1px solid ${t==="inbound"?"rgba(59,130,246,0.3)":"rgba(249,115,22,0.3)"}` }),
  statusBadge: (s:BatchStatus) => { const m:any={Created:{bg:"rgba(59,130,246,0.15)",c:"#3B82F6",b:"rgba(59,130,246,0.3)"},"In Transit":{bg:"rgba(245,158,11,0.15)",c:"#F59E0B",b:"rgba(245,158,11,0.3)"},Completed:{bg:"rgba(34,197,94,0.15)",c:"#22C55E",b:"rgba(34,197,94,0.3)"},Archived:{bg:"rgba(148,163,184,0.1)",c:"#94A3B8",b:"rgba(148,163,184,0.2)"}}; const x=m[s]||m.Created; return {display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:999,fontSize:11,fontWeight:700,background:x.bg,color:x.c,border:`1px solid ${x.b}`}; },
};
