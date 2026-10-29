/**
 * ZTACK Batch API transport. No Supabase credentials or browser-stored bearer tokens.
 * Backend contract must be implemented before switching production traffic.
 */
const configured = import.meta.env.VITE_BATCH_API_URL as string | undefined;
export const API_BASE = (configured || "").replace(/\/$/, "");
export type ApiError = Error & { status?: number };
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_BASE || !API_BASE.startsWith("https://")) throw new Error("Secure Batch API URL is not configured");
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(API_BASE + path, {
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
export const authApi = {
  me: () => api<{ user: Account }>("/auth/me"),
  login: (email: string, password: string) => api<{ user: Account }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
  register: (company_name: string, email: string, password: string) =>
    api<{ message: string }>("/auth/register", { method: "POST", body: JSON.stringify({ company_name, email, password }) }),
  verify: (token: string) => api<{ message: string }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),
  resend: (email: string) => api<{ message: string }>("/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) }),
  forgot: (email: string) => api<{ message: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  reset: (token: string, password: string) => api<{ message: string }>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),
};
