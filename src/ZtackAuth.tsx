import { useEffect, useState } from "react";
import { authApi, type Account } from "./ztackApi";
type Mode = "login" | "register" | "forgot" | "reset" | "verify";
export function ZtackAuth({ onLogin }: { onLogin: (user: Account) => void }) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const initial: Mode = params.get("action") === "verify" ? "verify" : params.get("action") === "reset" ? "reset" : "login";
  const [mode, setMode] = useState<Mode>(initial);
  const [resetComplete, setResetComplete] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (mode !== "verify" || !token) return;
    let active = true;
    authApi.verify(token).then(r => { if (active) setMessage(r.message || "Email verified. Sign in below."); })
      .catch(() => { if (active) setError("Verification link is invalid or expired."); });
    return () => { active = false; };
  }, [mode, token]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "login") { const result = await authApi.login(email, password); onLogin(result.user); }
      if (mode === "register") { await authApi.register(company, email, password); setMessage("Check your email for a verification link."); }
      if (mode === "forgot") { await authApi.forgot(email); setMessage("If an account exists, a password reset email will arrive shortly."); }
      if (mode === "reset") {
        if (!token) throw new Error("This reset link is missing its token. Request a new email.");
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        await authApi.reset(token, password);
        window.history.replaceState({}, "", window.location.pathname);
        setResetComplete(true);
        setPassword(""); setConfirmPassword("");
        setMessage("Password updated successfully. Return to sign in with your new password.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f2f5fb",padding:16}}>
    <section style={{width:"100%",maxWidth:400,background:"white",padding:30,borderRadius:16,boxShadow:"0 8px 30px #13244a20",fontFamily:"system-ui"}}>
      <h1 style={{marginTop:0}}>Batch ID Pro</h1><p>Powered by ZTACK · Supply chain tracking</p>
      <h2>{mode === "login" ? "Sign in" : mode === "register" ? "Create company" : mode === "forgot" ? "Reset password" : mode === "reset" ? "Choose a new password" : "Verify email"}</h2>
      {message && <p role="status" style={{color:"#166534"}}>{message}</p>}
      {error && <p role="alert" style={{color:"#b91c1c"}}>{error}</p>}
      {mode === "reset" && !token && <p role="alert">This reset link is incomplete. Request a new password-reset email.</p>}
      {mode !== "verify" && !(mode === "reset" && resetComplete) && <form onSubmit={submit}>
        {mode === "register" && <label>Company name<input required value={company} onChange={e=>setCompany(e.target.value)} style={{display:"block",width:"100%",padding:10,boxSizing:"border-box",marginBottom:12}} /></label>}
        {mode !== "reset" && <label>Email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} style={{display:"block",width:"100%",padding:10,boxSizing:"border-box",marginBottom:12}} /></label>}
        {mode !== "forgot" && <label>Password<input required minLength={mode === "login" ? 1 : 12} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e=>setPassword(e.target.value)} style={{display:"block",width:"100%",padding:10,boxSizing:"border-box",marginBottom:12}} /></label>}
        {mode === "reset" && <label>Confirm new password<input required minLength={12} type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} style={{display:"block",width:"100%",padding:10,boxSizing:"border-box",marginBottom:12}} /></label>}
        <button disabled={busy || (mode === "reset" && (!token || password !== confirmPassword))} style={{padding:12,width:"100%",background:"#365de5",color:"white",border:0,borderRadius:8,cursor:"pointer"}}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "register" ? "Create company" : mode === "forgot" ? "Send reset email" : "Save new password"}</button>
      </form>}
      {mode === "verify" && <button onClick={()=>setMode("login")}>Back to sign in</button>}
      {mode !== "login" && <p><button onClick={()=>{window.history.replaceState({}, "", window.location.pathname);setMode("login");setError("");setMessage("");setResetComplete(false);}}>Back to sign in</button></p>}
      {mode === "login" && <p><button onClick={()=>setMode("forgot")}>Forgot password?</button></p>}
      {mode === "login" && <p><button onClick={async()=>{setBusy(true);setError("");try{await authApi.resend(email);setMessage("If the account is pending, a new verification email will arrive.");}catch{setError("Unable to request verification email.");}finally{setBusy(false);}}} disabled={busy || !email}>Resend verification email</button></p>}
    </section>
  </main>;
}
