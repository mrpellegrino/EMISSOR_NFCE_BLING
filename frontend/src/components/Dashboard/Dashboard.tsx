import { useBlingApi } from '../Accounts/BlingContext';
import { useState, useEffect } from 'react';

import './Dashboard.css';

interface DashboardProps {
  user: {
    id: string;
    name: string;
    email: string;
  };
  onLogout: () => void;
  onGoToSettings: () => void;
  onGoToPedidosVenda: () => void;
  onGoToFilaRPS: () => void;
  onGoToCrm: () => void;
  onGoToAds: () => void;
  onGoToMcp: () => void;
}

interface EstatisticasRPS {
  pendentes: number;
  processando: number;
  emitidos: number;
  erros: number;
  total: number;
}

function Dashboard({
  user,
  onLogout,
  onGoToSettings,
  onGoToPedidosVenda,
  onGoToFilaRPS,
  onGoToCrm,
  onGoToAds,
  onGoToMcp,
}: DashboardProps) {
  const { getEstatisticasRPS } = useBlingApi();
  const [estatisticas, setEstatisticas] = useState<EstatisticasRPS>({
    pendentes: 0,
    processando: 0,
    emitidos: 0,
    erros: 0,
    total: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getEstatisticasRPS().then(counts => {
      if (cancelled) return;
      setEstatisticas({ ...counts, total: counts.pendentes + counts.processando + counts.emitidos + counts.erros });
      setError('');
    }).catch(error => {
      if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
      setError('Não foi possível consultar o resumo desta conta. Verifique a conexão e tente novamente.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [getEstatisticasRPS, attempt]);

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Vila Pet Office — Gestão & Emissor NFSe</span>
        </div>
        <div className="header-user">
          <div className="user-info">
            <span className="user-name">{user.name}</span>
            <span className="user-email">{user.email}</span>
          </div>
          <button className="settings-button" onClick={onGoToSettings} title="Configurações">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 1V3M12 21V23M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M1 12H3M21 12H23M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="logout-button" onClick={onLogout}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 17L21 12L16 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Sair
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="welcome-section">
          <h1>Olá, {user.name.split(' ')[0]}! 👋</h1>
          <p>Camada de gestão Vila Pet integrada ao Bling ERP, CRM do Site, Tráfego Pago e Agente Hermes (MCP).</p>
        </div>

        <div className="section-subtitle">Fiscal & ERP Bling (Emissão de Notas)</div>
        {/* Cards de Navegação Principal */}
        <div className="main-cards">
          <div className="main-card pedidos" onClick={onGoToPedidosVenda}>
            <div className="card-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 5H7C6.46957 5 5.96086 5.21071 5.58579 5.58579C5.21071 5.96086 5 6.46957 5 7V19C5 19.5304 5.21071 20.0391 5.58579 20.4142C5.96086 20.7893 6.46957 21 7 21H17C17.5304 21 18.0391 20.7893 18.4142 20.4142C18.7893 20.0391 19 19.5304 19 19V7C19 6.46957 18.7893 5.96086 18.4142 5.58579C18.0391 5.21071 17.5304 5 17 5H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 5C9 4.46957 9.21071 3.96086 9.58579 3.58579C9.96086 3.21071 10.4696 3 11 3H13C13.5304 3 14.0391 3.21071 14.4142 3.58579C14.7893 3.96086 15 4.46957 15 5C15 5.53043 14.7893 6.03914 14.4142 6.41421C14.0391 6.78929 13.5304 7 13 7H11C10.4696 7 9.96086 6.78929 9.58579 6.41421C9.21071 6.03914 9 5.53043 9 5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 12H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 16H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="card-content">
              <h2>Pedidos de Venda</h2>
              <p>Selecione pedidos do Bling para gerar RPS e gerencie metas</p>
            </div>
            <div className="card-arrow">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          <div className="main-card fila" onClick={onGoToFilaRPS}>
            <div className="card-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 4H18C18.5304 4 19.0391 4.21071 19.4142 4.58579C19.7893 4.96086 20 5.46957 20 6V20C20 20.5304 19.7893 21.0391 19.4142 21.4142C19.0391 21.7893 18.5304 22 18 22H6C5.46957 22 4.96086 21.7893 4.58579 21.4142C4.21071 21.0391 4 20.5304 4 20V6C4 5.46957 4.21071 4.96086 4.58579 4.58579C4.96086 4.21071 5.46957 4 6 4H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 2H9C8.44772 2 8 2.44772 8 3V5C8 5.55228 8.44772 6 9 6H15C15.5523 6 16 5.55228 16 5V3C16 2.44772 15.5523 2 15 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 14L11 16L15 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="card-content">
              <h2>Fila de Emissão de Notas Fiscais de Serviço</h2>
              <p>Gerencie e emita notas fiscais de serviço em lote</p>
            </div>
            <div className="card-arrow">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        </div>

        <div className="section-subtitle">Gestão Comercial, Tráfego Pago & IA (Hermes MCP)</div>
        <div className="main-cards">
          <div className="main-card crm" onClick={onGoToCrm}>
            <div className="card-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                <path d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="card-content">
              <h2>CRM de Leads (Site Vila Pet)</h2>
              <p>Identifique leads do site, acompanhe o funil e vincule ao pedido no Bling</p>
            </div>
            <div className="card-arrow">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          <div className="main-card ads" onClick={onGoToAds}>
            <div className="card-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 20V10M12 20V4M6 20V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="card-content">
              <h2>Gestão de Tráfego Pago & ROAS</h2>
              <p>Cruze investimentos de Google/Meta Ads com Leads do CRM e vendas no Bling</p>
            </div>
            <div className="card-arrow">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          <div className="main-card mcp" onClick={onGoToMcp}>
            <div className="card-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2"/>
                <rect x="9" y="9" width="6" height="6" stroke="currentColor" strokeWidth="2"/>
                <path d="M9 1V4M15 1V4M9 20V23M15 20V23M20 9H23M20 14H23M1 9H4M1 14H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="card-content">
              <h2>Hub MCP — Agente Hermes</h2>
              <p>Servidor MCP intermediário entre o Bling ERP, o CRM, o Tráfego e o Hermes</p>
            </div>
            <div className="card-arrow">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        </div>

        {/* Estatísticas da Fila */}
        <div className="stats-section">
          <h3>Resumo da Fila RPS</h3>
          {loading ? (
            <div className="stats-loading">Carregando...</div>
          ) : error ? (
            <div className="stats-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => { setLoading(true); setError(''); setAttempt(value => value + 1); }}>Tentar novamente</button>
            </div>
          ) : (
            <div className="stats-grid">
              <div className="stat-card pending" onClick={onGoToFilaRPS}>
                <div className="stat-value">{estatisticas.pendentes}</div>
                <div className="stat-label">Pendentes</div>
              </div>
              <div className="stat-card processing" onClick={onGoToFilaRPS}>
                <div className="stat-value">{estatisticas.processando}</div>
                <div className="stat-label">Processando</div>
              </div>
              <div className="stat-card success" onClick={onGoToFilaRPS}>
                <div className="stat-value">{estatisticas.emitidos}</div>
                <div className="stat-label">Emitidos</div>
              </div>
              <div className="stat-card error" onClick={onGoToFilaRPS}>
                <div className="stat-value">{estatisticas.erros}</div>
                <div className="stat-label">Com Erro</div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
