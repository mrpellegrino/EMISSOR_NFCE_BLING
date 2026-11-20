import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { createAccount, listAccounts } from '../../services/accountApi';
import type { BlingAccount } from '../../services/accountApi';
import { createBlingApi } from '../../services/blingApi';
import { BlingContext } from './BlingContext';
import './Accounts.css';

function AccountScope({ accountId, children }: { accountId: number; children: ReactNode }) {
  const api = useMemo(() => createBlingApi(accountId), [accountId]);
  useLayoutEffect(() => { api.activate(); return () => api.dispose(); }, [api]);
  return <BlingContext.Provider value={api}>{children}</BlingContext.Provider>;
}

export function Accounts({ userId, onCreated, onLogout, children }: {
  userId: string; onCreated: () => void; onLogout: () => void; children: ReactNode;
}) {
  const storageKey = 'bling-account:' + userId;
  const [accounts, setAccounts] = useState<BlingAccount[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    listAccounts().then(items => {
      if (cancelled) return;
      setAccounts(items);
      const callbackId = Number(new URLSearchParams(window.location.search).get('account'));
      const remembered = Number(sessionStorage.getItem(storageKey));
      const selected = items.find(a => a.id === callbackId) ?? items.find(a => a.id === remembered) ?? items[0];
      setActiveId(selected?.id ?? null);
      if (selected) sessionStorage.setItem(storageKey, String(selected.id));
      setError('');
    }).catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [storageKey, attempt]);

  const select = (id: number) => {
    sessionStorage.setItem(storageKey, String(id));
    setActiveId(id);
    setError('');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true); setError('');
    try {
      const account = await createAccount(name.trim());
      setAccounts(items => [...items, account]);
      select(account.id); setName(''); setAdding(false); onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível adicionar a conta.'); }
    finally { setSaving(false); }
  };
  const active = accounts.find(a => a.id === activeId);
  return <>
    <section className="account-bar" aria-label="Contas Bling">
      <div className="account-bar-inner">
        <div className="account-brand"><strong>Suas contas Bling</strong><span>Configurações e histórico separados por conta</span></div>
        <div className="account-controls">
          <label htmlFor="active-account">Conta selecionada</label>
          <select id="active-account" value={activeId ?? ''} onChange={e => select(Number(e.target.value))} disabled={loading || saving || !accounts.length}>
            {!accounts.length && <option value="">{loading ? 'Carregando...' : 'Nenhuma conta cadastrada'}</option>}
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="button" onClick={() => setAdding(true)} disabled={loading || saving}>+ Adicionar conta</button>
          <button type="button" className="account-logout" onClick={onLogout}>Sair</button>
        </div>
      </div>
      {error && <div className="account-error" role="alert">{error} <button onClick={() => { setLoading(true); setAttempt(n => n + 1); }}>Tentar novamente</button></div>}
      {(adding || (!loading && !error && !accounts.length)) && <form className="account-form" onSubmit={submit}>
        <div><h2>{accounts.length ? 'Adicionar outra conta' : 'Adicione sua primeira conta'}</h2><p>Escolha um nome para identificar a empresa. Depois, configure a integração com o Bling.</p></div>
        <label htmlFor="account-name">Nome da conta</label>
        <input id="account-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Matriz, Filial Centro" maxLength={100} required disabled={saving} autoFocus />
        <button disabled={saving || !name.trim()}>{saving ? 'Adicionando...' : 'Adicionar e configurar'}</button>
        {accounts.length > 0 && <button type="button" onClick={() => { setAdding(false); setName(''); }} disabled={saving}>Cancelar</button>}
      </form>}
    </section>
    {loading ? <div className="accounts-loading" role="status">Carregando suas contas...</div> : active && <div key={active.id}>
      <AccountScope accountId={active.id}>{children}</AccountScope>
    </div>}
  </>;
}
