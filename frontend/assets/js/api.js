async function apiFetch(path, options) {
  const base = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://localhost:3011";
  const url = base + path;

  const res = await fetch(url, {
    credentials: "include",
    ...options
  });
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      (data && data.message) ||
      (typeof data === "string" && data) ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data;
}

async function apiGet(path) {
  return apiFetch(path, { method: "GET" });
}

async function apiPost(path, body) {
  return apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
}

window.Api = { apiGet, apiPost };

