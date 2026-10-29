/**
 * ZTACK Batch API transport. No Supabase credentials or browser-stored bearer tokens.
 * Backend contract must be implemented before switching production traffic.
 */
const configured = import.meta.env.VITE_BATCH_API_URL as string | undefined;
export const API_BASE = (configured || "").replace(/\/$/, "");
let csrf = "";
export function setCsrf(value: string) { csrf = value; }
export type ApiError = Error & { status?: number };
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (API_BASE && !API_BASE.startsWith("https://")) throw new Error("Secure Batch API URL is not configured");
  const headers = new Headers(init.headers);
  if (csrf && init.method && init.method !== "GET") headers.set("X-CSRF-Token", csrf);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(API_BASE + "/api" + path, {
    ...init, headers, credentials: "include", cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof body?.error === "string" ? body.error : "Request failed") as ApiError;
    error.status = response.status;
    throw error;
  }
  return body as T;
}
export type Account = { id: string; email: string; role: "Owner" | "Employee"; company_id: string; company_name?: string; email_verified?: boolean };
function session(r: any): { user: Account } { if (r.csrf) setCsrf(r.csrf); return { user: { id:r.user.id, email:r.user.email || "", role:r.user.role, company_id:r.user.companyId, company_name:r.company?.name, email_verified:r.user.email_verified } }; }
export const authApi = {
  me: async () => session(await api<any>("/auth/session")),
  login: async (email: string, password: string) => session(await api<any>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })),
  logout: async () => { await api<void>("/auth/logout", { method: "POST" }); setCsrf(""); },
  register: (company_name: string, email: string, password: string) =>
    api<{ message: string }>("/auth/register", { method: "POST", body: JSON.stringify({ company: company_name, email, password }) }),
  verify: (token: string) => api<{ message: string }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),
  resend: (email: string) => api<{ message: string }>("/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) }),
  forgot: (email: string) => api<{ message: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  reset: (token: string, password: string) => api<{ message: string }>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),
};
