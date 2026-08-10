const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const getToken = (): string | null =>
  localStorage.getItem("coopinsight_access_token");

const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken = localStorage.getItem("coopinsight_refresh_token");
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      localStorage.removeItem("coopinsight_access_token");
      localStorage.removeItem("coopinsight_refresh_token");
      localStorage.removeItem("coopinsight_user");
      window.location.href = "/login";
      return null;
    }
    const data = await res.json();
    localStorage.setItem("coopinsight_access_token", data.accessToken);
    return data.accessToken;
  } catch {
    return null;
  }
};

export const apiRequest = async <T = any>(
  endpoint: string,
  options: { method?: string; body?: object } = {}
): Promise<T> => {
  const { method = "GET", body } = options;

  const makeRequest = (token: string | null) => {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(`${BASE_URL}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  let res = await makeRequest(getToken());

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) res = await makeRequest(newToken);
  }

  const data = await res.json();
  if (!res.ok) throw { status: res.status, message: data.message ?? "Request failed", data };
  return data;
};

export const api = {
  get:    <T = any>(url: string)               => apiRequest<T>(url, { method: "GET" }),
  post:   <T = any>(url: string, body: object) => apiRequest<T>(url, { method: "POST",  body }),
  put:    <T = any>(url: string, body: object) => apiRequest<T>(url, { method: "PUT",   body }),
  patch:  <T = any>(url: string, body: object) => apiRequest<T>(url, { method: "PATCH", body }),
  delete: <T = any>(url: string)               => apiRequest<T>(url, { method: "DELETE" }),
};
