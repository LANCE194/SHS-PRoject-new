let token = localStorage.getItem('ambakToken');
export const setToken = t => { token = t; t ? localStorage.setItem('ambakToken', t) : localStorage.removeItem('ambakToken'); };
const headers = () => ({ 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) });
export async function api(url, method = 'GET', body) {
  const res = await fetch('/api' + url, { method, headers: headers(), body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && url !== '/login') { setToken(null); location.reload(); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { data });
  return data;
}
export async function download(url, name) {
  const res = await fetch('/api' + url, { headers: headers() });
  if (!res.ok) throw new Error('Export failed');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
