export interface BlingAccount { id: number; name: string; configured: boolean; isActive: boolean }
const API_URL = `${(import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')}/bling/accounts`;
async function request(init: RequestInit = {}) {
  const response = await fetch(API_URL, { ...init, headers: {
    'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('access_token'),
  } });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Não foi possível carregar as contas.');
  }
  return response.json();
}
export const listAccounts = (): Promise<BlingAccount[]> => request();
export const createAccount = (name: string): Promise<BlingAccount> => request({ method: 'POST', body: JSON.stringify({ name }) });
