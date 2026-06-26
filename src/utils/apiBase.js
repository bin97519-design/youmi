const rawBase = import.meta.env.VITE_APP_BASE_API || '';

export const API_BASE = rawBase.replace(/\/+$/, '');

export function apiPath(path = '') {
  if (!path) return API_BASE || '/';
  if (/^https?:\/\//i.test(path)) return path;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}
