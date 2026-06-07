async function apiFetch(path, options) {
  const base = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://localhost:3011";
  const url = base + path;
  const timeoutMs = 15000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      credentials: "include",
      signal: controller.signal,
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
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        "Server took too long to respond. Check that SQL Server is running and run npm run db:test."
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

async function apiPut(path, body) {
  return apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
}

async function apiDelete(path) {
  return apiFetch(path, { method: "DELETE" });
}

window.Api = { apiGet, apiPost, apiPut, apiDelete };
