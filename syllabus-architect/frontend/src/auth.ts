// Receives the Cognito ID token handed off by the ELT Editorial Utils
// portal via a URL hash fragment (#id_token=...), and exposes it for
// attaching to API requests. This app never initiates its own Cognito
// login flow - the portal owns that. login()/logout() below simply
// send the browser to the portal (which owns the actual Cognito flow),
// matching the pattern used by other apps launched from this portal.

const TOKEN_KEY = "id_token";
const PORTAL_URL = "https://elt-editorial-utils.elt.edu.oup.com";

function parseJwtPayload(token: string): { exp?: number } {
  const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

export function captureTokenFromHash(): void {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get("id_token");
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

export function getToken(): string | null {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    const payload = parseJwtPayload(token);
    if (!payload.exp || payload.exp * 1000 < Date.now()) {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return token;
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

export function isAuthenticated(): boolean {
  if (import.meta.env.VITE_AUTH_DISABLED === "true") return true;
  return getToken() !== null;
}

export function login(): void {
  window.location.href = PORTAL_URL;
}

export function logout(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  window.location.href = PORTAL_URL;
}
