import { useState, useEffect, useCallback } from 'react';
import {
  officeApi,
  type AdCampaignMetric,
  type AdPlatform,
  type PaidTrafficPerformance,
} from '../../services/officeApi';
import { formatBRL } from '../../services/currency';
import './OfficeModules.css';

interface PaidTrafficProps {
  onBack: () => void;
}

const PLATFORM_LABELS: Record<AdPlatform, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads (Facebook / Instagram)',
  tiktok_ads: 'TikTok Ads',
  outros: 'Outros Canais',
};

export function PaidTraffic({ onBack }: PaidTrafficProps) {
  const [perf, setPerf] = useState<PaidTrafficPerformance | null>(null);
  const [records, setRecords] = useState<AdCampaignMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [platform, setPlatform] = useState<AdPlatform>('google_ads');
  const [campaignName, setCampaignName] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [spend, setSpend] = useState('');
  const [impressions, setImpressions] = useState('');
  const [clicks, setClicks] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [perfData, metricList] = await Promise.all([
        officeApi.getPaidTrafficPerformance(),
        officeApi.listAdMetrics(),
      ]);
      setPerf(perfData);
      setRecords(metricList);
      setError('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao carregar dados de Tráfego Pago',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignName.trim() || !spend) return;
    try {
      await officeApi.upsertAdMetric({
        platform,
        campaignName: campaignName.trim(),
        utmCampaign: utmCampaign.trim() || null,
        date,
        spend: Number(spend),
        impressions: impressions ? Number(impressions) : 0,
        clicks: clicks ? Number(clicks) : 0,
      });
      setCampaignName('');
      setUtmCampaign('');
      setSpend('');
      setImpressions('');
      setClicks('');
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao registrar campanha',
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await officeApi.deleteAdMetric(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir registro');
    }
  };

  return (
    <div className="office-page">
      <header className="office-header">
        <div className="office-header-left">
          <button className="office-back-btn" onClick={onBack}>
            ← Voltar ao Painel
          </button>
          <div className="office-title-group">
            <h1>Gestão de Tráfego Pago & ROAS — Vila Pet</h1>
            <p>
              Cruzamento automático de investimentos em anúncios com Leads do
              CRM e Faturamento Emitido no Bling ERP
            </p>
          </div>
        </div>
      </header>

      <div className="office-container">
        {error && (
          <div
            style={{
              background: '#fee2e2',
              color: '#b91c1c',
              padding: '12px 16px',
              borderRadius: '8px',
            }}
          >
            {error}
          </div>
        )}

        {perf && (
          <div className="office-kpi-grid">
            <div className="office-kpi-card">
              <div className="office-kpi-label">Investimento em Ads</div>
              <div className="office-kpi-value">
                {formatBRL(perf.totals.totalSpend)}
              </div>
              <div className="office-kpi-sub">
                {perf.totals.totalClicks} cliques · CTR {perf.totals.avgCtr}%
              </div>
            </div>
            <div className="office-kpi-card blue">
              <div className="office-kpi-label">CPL / CAC (Leads Pagos)</div>
              <div className="office-kpi-value">
                {formatBRL(perf.totals.avgCpl)}
              </div>
              <div className="office-kpi-sub">
                CAC: {formatBRL(perf.totals.avgCac)} (
                {perf.totals.totalPaidLeads} leads)
              </div>
            </div>
            <div className="office-kpi-card purple">
              <div className="office-kpi-label">ROAS Atribuído (CRM)</div>
              <div className="office-kpi-value">{perf.totals.crmRoas}x</div>
              <div className="office-kpi-sub">
                Receita CRM: {formatBRL(perf.totals.attributedCrmRevenue)}
              </div>
            </div>
            <div className="office-kpi-card green">
              <div className="office-kpi-label">Faturamento Bling (NFSe)</div>
              <div className="office-kpi-value">
                {formatBRL(perf.totals.totalBlingEmitidoRevenue)}
              </div>
              <div className="office-kpi-sub">
                ROAS Global Bling: {perf.totals.blendedBlingRoas}x
              </div>
            </div>
          </div>
        )}

        <div className="office-panel">
          <div className="office-panel-header">
            <h2>Registrar Investimento / Métricas de Campanha</h2>
          </div>
          <form onSubmit={handleSave}>
            <div className="office-form-grid">
              <div className="office-field">
                <label>Plataforma</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as AdPlatform)}
                >
                  {Object.entries(PLATFORM_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="office-field">
                <label>Nome da Campanha *</label>
                <input
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="Ex: Pesquisa - Banho e Tosa"
                  required
                />
              </div>
              <div className="office-field">
                <label>Tag utm_campaign (p/ cruzar com Site)</label>
                <input
                  value={utmCampaign}
                  onChange={(e) => setUtmCampaign(e.target.value)}
                  placeholder="Ex: google-banho-tosa"
                />
              </div>
              <div className="office-field">
                <label>Data</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="office-field">
                <label>Valor Investido (R$) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={spend}
                  onChange={(e) => setSpend(e.target.value)}
                  placeholder="250.00"
                  required
                />
              </div>
              <div className="office-field">
                <label>Impressões</label>
                <input
                  type="number"
                  value={impressions}
                  onChange={(e) => setImpressions(e.target.value)}
                  placeholder="4500"
                />
              </div>
              <div className="office-field">
                <label>Cliques</label>
                <input
                  type="number"
                  value={clicks}
                  onChange={(e) => setClicks(e.target.value)}
                  placeholder="180"
                />
              </div>
              <div
                className="office-field"
                style={{ justifyContent: 'flex-end' }}
              >
                <button type="submit" className="office-btn">
                  + Lançar Métricas
                </button>
              </div>
            </div>
          </form>
        </div>

        <div className="office-panel">
          <div className="office-panel-header">
            <h2>Performance Consolidada por Campanha</h2>
          </div>
          {loading ? (
            <p style={{ color: '#6b7280' }}>Calculando métricas...</p>
          ) : !perf || perf.campaigns.length === 0 ? (
            <p style={{ color: '#6b7280' }}>
              Nenhuma campanha registrada ainda. Lance os dados acima ou peça ao
              agente Hermes via MCP.
            </p>
          ) : (
            <div className="office-table-wrap">
              <table className="office-table">
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th>Plataforma</th>
                    <th>Investimento</th>
                    <th>Cliques / CTR</th>
                    <th>CPC</th>
                    <th>Leads (Site) / Vendas</th>
                    <th>CPL / CAC</th>
                    <th>Receita / ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.campaigns.map((c) => (
                    <tr key={c.campaignKey}>
                      <td>
                        <strong>{c.campaignName}</strong>
                        {c.utmCampaign && (
                          <div style={{ fontSize: 11, color: '#6b7280' }}>
                            utm: <code>{c.utmCampaign}</code>
                          </div>
                        )}
                      </td>
                      <td>
                        {PLATFORM_LABELS[c.platform as AdPlatform] ||
                          c.platform}
                      </td>
                      <td>{formatBRL(c.spend)}</td>
                      <td>
                        {c.clicks} ({c.ctr}%)
                      </td>
                      <td>{formatBRL(c.cpc)}</td>
                      <td>
                        {c.crmLeads} leads / {c.crmConverted} vendas
                      </td>
                      <td>
                        CPL {formatBRL(c.cpl)} · CAC {formatBRL(c.cac)}
                      </td>
                      <td>
                        <strong>{formatBRL(c.attributedRevenue)}</strong> (
                        {c.roas}x)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {records.length > 0 && (
          <div className="office-panel">
            <div className="office-panel-header">
              <h2>Histórico de Lançamentos ({records.length})</h2>
            </div>
            <div className="office-table-wrap">
              <table className="office-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Campanha</th>
                    <th>Plataforma</th>
                    <th>Investimento</th>
                    <th>Impressões</th>
                    <th>Cliques</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>{r.date}</td>
                      <td>{r.campaignName}</td>
                      <td>{PLATFORM_LABELS[r.platform] || r.platform}</td>
                      <td>{formatBRL(r.spend)}</td>
                      <td>{r.impressions}</td>
                      <td>{r.clicks}</td>
                      <td>
                        <button
                          type="button"
                          className="office-btn danger"
                          onClick={() => handleDelete(r.id)}
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
