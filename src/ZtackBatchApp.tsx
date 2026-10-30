import { useEffect, useMemo, useState } from "react";
import { api, authApi, type Account } from "./ztackApi";
import { ZtackAuth } from "./ZtackAuth";
import { QRCodeSVG } from "qrcode.react";
import "./ztack.css";

type Docket = { id: string; batchId: string; type: "Inbound" | "Outbound"; status: string; lines: {speciesCode:string;speciesName:string;qty:number}[]; version:number; fromCompanyName:string; toCompanyName:string; createdAt:string; fromCompanyId:string; toCompanyId:string; notes?:string; receiptToken?:string; completedAt?:string };
type DocketInput = { species: string; weight_kg: number; from_company: string; to_company: string; notes: string };
const empty: DocketInput = { species: "", weight_kg: 0, from_company: "", to_company: "", notes: "" };
function formatDate(date?: string) { return date ? new Date(date).toLocaleString("en-GB") : "—"; }
function label(d: Docket) { return d.batchId || d.id.slice(0, 8); }
function species(d:Docket) { return (d.lines||[]).map(x=>x.speciesName).join(", "); }
function weight(d:Docket) { return (d.lines||[]).reduce((sum,x)=>sum+x.qty,0); }
export default function ZtackBatchApp() {
  const [user, setUser] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [dockets, setDockets] = useState<Docket[]>([]);
  const [view, setView] = useState<"dashboard"|"dockets"|"new"|"archive"|"settings">("dashboard");
  const [selected, setSelected] = useState<Docket | null>(null);
  const [draft, setDraft] = useState<DocketInput>(empty);
  const [direction,setDirection] = useState<"Inbound"|"Outbound">("Outbound");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const query = new URLSearchParams(window.location.search);
  const authAction = query.get("action");
  const receiptId = query.get("receipt");
  const receiptToken = new URLSearchParams(window.location.search).get("token") || receiptId;
  const [receipt, setReceipt] = useState<Docket | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(!!receiptId);
  const [receiptError, setReceiptError] = useState("");
  useEffect(() => {
    if (receiptId && receiptToken) {
      api<Docket>(`/receipts/${encodeURIComponent(receiptToken)}`)
        .then(r => setReceipt(r)).catch(() => setReceiptError("Receipt link is invalid or expired."))
        .finally(() => setReceiptLoading(false));
      return;
    }
    if (receiptId) { setReceiptError("A secure receipt token is required."); setReceiptLoading(false); return; }
    authApi.me().then(r => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, [receiptId, receiptToken]);
  async function refresh(archive = showArchived) {
    try {
      const result = await api<Docket[]>("/dockets");
      setDockets(archive ? result.filter(d=>d.status==="Complete"||d.status==="Voided") : result);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load dockets"); }
  }
  useEffect(() => { if (user) void refresh(); }, [user]);
  const filtered = useMemo(() => dockets.filter(d => [label(d),species(d),d.fromCompanyName,d.toCompanyName,d.status].join(" ").toLowerCase().includes(filter.toLowerCase())), [dockets,filter]);
  const stats = useMemo(() => ({
    total: dockets.length, transit: dockets.filter(d=>/transit|sent/i.test(d.status)).length,
    completed: dockets.filter(d=>/complete/i.test(d.status)).length,
    drafts: dockets.filter(d=>/draft|created/i.test(d.status)).length,
  }), [dockets]);
  async function act(path: string, body?: object, method = "POST") {
    setBusy(true);setError("");setNotice("");
    try {
      await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      setNotice("Saved successfully."); await refresh();
      if (selected) { const rows = await api<Docket[]>("/dockets");setSelected(rows.find(d=>d.id===selected.id)||null); }
    } catch(e) {setError(e instanceof Error ? e.message : "Operation failed");}
    finally {setBusy(false);}
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();setBusy(true);setError("");
    try {
      const companyId = user?.company_id || "";
      const d: Docket = {id:crypto.randomUUID(),batchId:"NEW",type:direction,status:"Created",lines:[{speciesCode:draft.species.trim().slice(0,30).toUpperCase(),speciesName:draft.species,qty:draft.weight_kg}],version:1,fromCompanyId:direction==="Outbound"?companyId:"external",toCompanyId:direction==="Inbound"?companyId:"external",fromCompanyName:draft.from_company,toCompanyName:draft.to_company,createdAt:new Date().toISOString(),notes:draft.notes};
      await api("/dockets", {method:"POST",body:JSON.stringify(Object.fromEntries(Object.entries(d).filter(([key])=>key!=="version")))});
      setDraft(empty);setView("dockets");setNotice("Docket created.");await refresh();
    } catch(e){setError(e instanceof Error ? e.message : "Could not create docket");}
    finally{setBusy(false);}
  }
  if (receiptId) return <main className="batch-shell receipt">
    <h1>Batch ID Pro · Receipt confirmation</h1>
    {receiptLoading ? <p>Checking receipt…</p> : receiptError ? <p role="alert">{receiptError}</p> : receipt ? <>
      <h2>{label(receipt)}</h2><p>Status: {receipt.status}</p><p>From: {receipt.fromCompanyName || "—"} · To: {receipt.toCompanyName || "—"}</p>
      <p>Species: {species(receipt) || "—"} · Weight: {weight(receipt)} kg</p>
      {receipt.status !== "Complete" && <button disabled={busy} onClick={async()=>{
        setBusy(true);setReceiptError("");
        try { const r = await api<Docket>(`/receipts/${encodeURIComponent(receiptToken)}/confirm`,{method:"POST",body:JSON.stringify({action:"receive",expectedStatus:receipt.status})});setReceipt(r); }
        catch {setReceiptError("Could not confirm receipt. Link may be expired.");} finally {setBusy(false);}
      }}>Confirm goods received</button>}
      {receipt.status === "Complete" && <p>Receipt confirmed {formatDate(receipt.completedAt)}</p>}
    </> : null}
  </main>;
  if (loading) return <main className="batch-loading">Connecting to Batch ID Pro…</main>;
  if (!user || authAction === "verify" || authAction === "reset") return <ZtackAuth onLogin={setUser}/>;
  const canEdit = user.role === "Owner";
  return <div className="batch-layout">
    <aside className="batch-sidebar">
      <div className="batch-brand"><strong>Batch ID Pro</strong><small>by ZTACK</small></div>
      {(["dashboard","dockets","new","archive","settings"] as const).map(v=><button key={v} className={view===v?"active":""} onClick={()=>{setView(v);setSelected(null);setError("");if(v==="archive"){setShowArchived(true);void refresh(true);}else if(showArchived){setShowArchived(false);void refresh(false);}}} disabled={v==="new"&&!canEdit}>{({dashboard:"Overview",dockets:"Dockets",new:"New docket",archive:"Archive",settings:"Settings"})[v]}</button>)}
      <div className="batch-sidebar-bottom"><small>{user.company_name || "Your company"}</small><small>{user.email}</small><button onClick={async()=>{try{await authApi.logout();}finally{setUser(null);setDockets([]);}}}>Sign out</button></div>
    </aside>
    <main className="batch-main">
      <header><div><small>Supply chain traceability</small><h1>{({dashboard:"Overview",dockets:"Dockets",new:"Create docket",archive:"Archive",settings:"Account settings"})[view]}</h1></div><span className="batch-pill">{user.role}</span></header>
      {error && <p className="batch-error" role="alert">{error}</p>}
      {notice && <p className="batch-notice" role="status">{notice}</p>}
      {view==="dashboard" && <><div className="batch-stats">{([["Total dockets",stats.total],["Draft",stats.drafts],["In transit",stats.transit],["Completed",stats.completed]] as const).map(([name,value])=><article key={name}><small>{name}</small><strong>{value}</strong></article>)}</div><h2>Recent dockets</h2><DocketTable items={filtered.slice(0,10)} onSelect={setSelected}/></>}
      {(view==="dockets"||view==="archive") && <><div className="batch-toolbar"><input aria-label="Search dockets" placeholder="Search dockets, companies or species…" value={filter} onChange={e=>setFilter(e.target.value)}/><button onClick={()=>void refresh()}>Refresh</button>{canEdit&&view==="dockets"&&<button className="primary" onClick={()=>setView("new")}>+ New docket</button>}</div><DocketTable items={filtered} onSelect={setSelected}/></>}
      {view==="new"&&canEdit&&<form className="batch-form" onSubmit={create}><p>Create a draft docket. You can confirm dispatch after checking the details.</p><label>Direction<select value={direction} onChange={e=>setDirection(e.target.value as "Inbound"|"Outbound")}><option>Outbound</option><option>Inbound</option></select></label>
        {(["species","from_company","to_company"] as const).map(k=><label key={k}>{({species:"Species",from_company:"Origin company",to_company:"Destination company"})[k]}<input required value={draft[k]} onChange={e=>setDraft({...draft,[k]:e.target.value})}/></label>)}
        <label>Weight (kg)<input required type="number" min="0.01" step="0.01" value={draft.weight_kg||""} onChange={e=>setDraft({...draft,weight_kg:Number(e.target.value)})}/></label>
        <label>Notes<textarea value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label><button className="primary" disabled={busy}>Save draft</button>
      </form>}
      {view==="settings"&&<section className="batch-panel"><h2>Company account</h2><p><strong>Company:</strong> {user.company_name || user.company_id}</p><p><strong>Email:</strong> {user.email}</p><p><strong>Role:</strong> {user.role}</p><p><strong>Email verified:</strong> {user.email_verified ? "Yes" : "Not confirmed"}</p><p>Staff access and company details are controlled by the server. Contact your administrator for invitations.</p></section>}
      {selected && <div className="batch-overlay" role="presentation" onClick={()=>setSelected(null)}><section className="batch-detail" role="dialog" aria-modal="true" aria-label="Docket details" onClick={e=>e.stopPropagation()}><button className="batch-close" onClick={()=>setSelected(null)}>Close ×</button><h2>Docket {label(selected)}</h2><span className="batch-pill">{selected.status}</span><dl><dt>Species</dt><dd>{species(selected)||"—"}</dd><dt>Weight</dt><dd>{weight(selected)} kg</dd><dt>From</dt><dd>{selected.fromCompanyName||"—"}</dd><dt>To</dt><dd>{selected.toCompanyName||"—"}</dd><dt>Created</dt><dd>{formatDate(selected.createdAt)}</dd><dt>Notes</dt><dd>{selected.notes||"—"}</dd></dl>
      {canEdit && /draft|created/i.test(selected.status) && <button disabled={busy} className="primary" onClick={()=>void act(`/dockets/${encodeURIComponent(selected.id)}`,{version:selected.version,patch:{status:"In Transit"}},"PATCH")}>Confirm shipment & lock</button>}
      {selected.status==="In Transit" && <p>Shipment dispatched. Recipient confirmation is required to complete it.</p>}
      {selected.status==="Complete" && <p>Received {formatDate(selected.completedAt)}</p>}
      {selected.status.toLowerCase()==="in transit" && <ReceiptQr id={selected.id}/>}
      </section></div>}
    </main>
  </div>;
}
function DocketTable({items,onSelect}:{items:Docket[];onSelect:(d:Docket)=>void}) {
  if (!items.length) return <div className="batch-empty">No dockets found.</div>;
  return <div className="batch-table-wrap"><table><thead><tr><th>Docket</th><th>Species</th><th>Origin</th><th>Destination</th><th>Status</th><th>Created</th></tr></thead><tbody>{items.map(d=><tr key={d.id} onClick={()=>onSelect(d)} tabIndex={0} onKeyDown={e=>{if(e.key==="Enter")onSelect(d);}}><td>{label(d)}</td><td>{species(d)||"—"}</td><td>{d.fromCompanyName||"—"}</td><td>{d.toCompanyName||"—"}</td><td><span className="batch-pill">{d.status}</span></td><td>{formatDate(d.createdAt)}</td></tr>)}</tbody></table></div>;
}
function ReceiptQr({id}:{id:string}) {
  const [url,setUrl]=useState("");const [error,setError]=useState("");
  useEffect(()=>{api<Docket[]>("/dockets").then(rows=>{const d=rows.find(x=>x.id===id);if(!d?.receiptToken) throw new Error("No receipt token");setUrl(`${window.location.origin}/?receipt=${encodeURIComponent(d.receiptToken)}`);}).catch(()=>setError("Receipt link unavailable"));},[id]);
  return <div className="batch-qr"><h3>Secure receipt QR</h3>{url?<><QRCodeSVG value={url} size={180}/><p><a href={url} target="_blank" rel="noopener noreferrer">Open receipt confirmation</a></p></>:<p>{error||"Generating link…"}</p>}</div>;
}
