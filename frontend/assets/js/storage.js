function setJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getJson(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function clearKey(key) {
  localStorage.removeItem(key);
}

window.StorageUtil = {
  setJson,
  getJson,
  clearKey
};

