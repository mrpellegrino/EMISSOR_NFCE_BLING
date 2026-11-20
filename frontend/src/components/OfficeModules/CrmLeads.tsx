import { useState, useEffect, useCallback } from 'react';
import {
  officeApi,
  type CrmLead,
  type CrmFunnelMetrics,
  type LeadStage,
  type LeadSource,
} from '../../services/officeApi';
import { formatBRL } from '../../services/currency';
import './OfficeModules.css';

interface CrmLeadsProps {
  onBack: () => void;
}

const STAGE_LABELS: Record<LeadStage, string> = {
  novo: 'Novo Lead',
  em_atendimento: 'Em Atendimento',
  qualificado: 'Qualificado',
  convertido: 'Convertido (Venda)',
  perdido: 'Perdido',
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  site: 'Site Vila Pet',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads (FB/IG)',
  tiktok_ads: 'TikTok Ads',
  whatsapp: 'WhatsApp Direto',
  indicacao: 'Indicação',
  organico: 'Orgânico / SEO',
};

export function CrmLeads({ onBack }: CrmLeadsProps) {
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [metrics, setMetrics] = useState<CrmFunnelMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [search, setSearch] = useState('');
  const [showWebhookHelp, setShowWebhookHelp] = useState(false);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPetName, setNewPetName] = useState('');
  const [newInterest, setNewInterest] = useState('');
  const [newSource, setNewSource] = useState<LeadSource>('site');
  const [newUtmCampaign, setNewUtmCampaign] = useState('');
  const [newEstimatedValue, setNewEstimatedValue] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [leadList, funnel] = await Promise.all([
        officeApi.listLeads({
          stage: filterStage || undefined,
          source: filterSource || undefined,
          search: search || undefined,
        }),
        officeApi.getCrmMetrics(),
      ]);
      setLeads(leadList);
      setMetrics(funnel);
      setError('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao carregar o CRM de Leads',
      );
    } finally {
      setLoading(false);
    }
  }, [filterStage, filterSource, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await officeApi.createLead({
        name: newName.trim(),
        phone: newPhone.trim() || null,
        petName: newPetName.trim() || null,
        interest: newInterest.trim() || null,
        source: newSource,
        utmCampaign: newUtmCampaign.trim() || null,
        estimatedValue: newEstimatedValue ? Number(newEstimatedValue) : 0,
      });
      setNewName('');
      setNewPhone('');
      setNewPetName('');
      setNewInterest('');
      setNewUtmCampaign('');
      setNewEstimatedValue('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar lead');
    }
  };

  const handleStageChange = async (lead: CrmLead, stage: LeadStage) => {
    try {
      await officeApi.updateLead(lead.id, { stage });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar lead');
    }
  };

  const handleLinkBlingOrder = async (lead: CrmLead) => {
    const orderNumber = window.prompt(
      `Informe o número do Pedido de Venda no Bling para vincular ao lead "${lead.name}":`,
      lead.blingOrderNumber || '',
    );
    if (orderNumber === null) return;
    try {
      await officeApi.updateLead(lead.id, {
        blingOrderNumber: orderNumber.trim(),
      });
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao vincular pedido do Bling',
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await officeApi.deleteLead(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover lead');
    }
  };

  const webhookUrl = `${window.location.origin}/api/crm/webhook/leads`;

  return (
    <div className="office-page">
      <header className="office-header">
        <div className="office-header-left">
          <button className="office-back-btn" onClick={onBack}>
            ← Voltar ao Painel
          </button>
          <div className="office-title-group">
            <h1>CRM de Leads — Vila Pet</h1>
            <p>
              Captura de leads do site, rastreamento de campanhas (UTM) e
              conversão vinculada aos pedidos do Bling ERP
            </p>
          </div>
        </div>
        <button
          className="office-btn secondary"
          onClick={() => setShowWebhookHelp((v) => !v)}
        >
          {showWebhookHelp ? 'Ocultar Webhook do Site' : 'Webhook para o Site'}
        </button>
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

        {showWebhookHelp && (
          <div className="office-panel">
            <div className="office-panel-header">
              <h2>API de Captura para o Formulário do Site (Pública)</h2>
            </div>
            <p style={{ fontSize: 13, color: '#4b5563', marginTop: 0 }}>
              Envie um <code>POST</code> do formulário do site para{' '}
              <code>{webhookUrl}</code> (aceita campos em português ou inglês,
              já liberado no CORS para <code>vilapetbrasil.com.br</code> e com
              proteção anti-spam):
            </p>
            <pre className="office-code">{`// Cole no submit do formulário do site Vila Pet:
const params = new URLSearchParams(window.location.search);

await fetch('${webhookUrl}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    nome: form.nome,
    whatsapp: form.telefone,
    email: form.email,
    nomePet: form.nomePet,
    especie: form.especie,      // "cachorro", "gato", "outro"
    servico: form.interesse,    // ex: "Banho e Tosa"
    mensagem: form.mensagem,
    pagina: window.location.href,
    utm_source: params.get('utm_source') || undefined,
    utm_medium: params.get('utm_medium') || undefined,
    utm_campaign: params.get('utm_campaign') || undefined,
    gclid: params.get('gclid') || undefined,
    fbclid: params.get('fbclid') || undefined,
  }),
});`}</pre>
          </div>
        )}

        {metrics && (
          <div className="office-kpi-grid">
            <div className="office-kpi-card blue">
              <div className="office-kpi-label">Total de Leads</div>
              <div className="office-kpi-value">{metrics.totalLeads}</div>
              <div className="office-kpi-sub">
                {metrics.stages.novo} novos · {metrics.stages.em_atendimento} em
                atendimento
              </div>
            </div>
            <div className="office-kpi-card purple">
              <div className="office-kpi-label">Taxa de Conversão</div>
              <div className="office-kpi-value">{metrics.conversionRate}%</div>
              <div className="office-kpi-sub">
                {metrics.stages.convertido} clientes convertidos
              </div>
            </div>
            <div className="office-kpi-card amber">
              <div className="office-kpi-label">Pipeline Estimado</div>
              <div className="office-kpi-value">
                {formatBRL(metrics.pipelineEstimatedValue)}
              </div>
              <div className="office-kpi-sub">Oportunidades ativas</div>
            </div>
            <div className="office-kpi-card green">
              <div className="office-kpi-label">Receita Convertida</div>
              <div className="office-kpi-value">
                {formatBRL(metrics.convertedRevenue)}
              </div>
              <div className="office-kpi-sub">
                Vendas atribuídas aos leads
              </div>
            </div>
          </div>
        )}

        <div className="office-panel">
          <div className="office-panel-header">
            <h2>Cadastrar Novo Lead Manualmente</h2>
          </div>
          <form onSubmit={handleCreateLead}>
            <div className="office-form-grid">
              <div className="office-field">
                <label>Nome do Cliente *</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: João Mendes"
                  required
                />
              </div>
              <div className="office-field">
                <label>WhatsApp / Telefone</label>
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="11999990000"
                />
              </div>
              <div className="office-field">
                <label>Nome do Pet</label>
                <input
                  value={newPetName}
                  onChange={(e) => setNewPetName(e.target.value)}
                  placeholder="Ex: Mel"
                />
              </div>
              <div className="office-field">
                <label>Interesse (Produto/Serviço)</label>
                <input
                  value={newInterest}
                  onChange={(e) => setNewInterest(e.target.value)}
                  placeholder="Ex: Banho e Tosa"
                />
              </div>
              <div className="office-field">
                <label>Origem</label>
                <select
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value as LeadSource)}
                >
                  {Object.entries(SOURCE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="office-field">
                <label>Campanha (utm_campaign)</label>
                <input
                  value={newUtmCampaign}
                  onChange={(e) => setNewUtmCampaign(e.target.value)}
                  placeholder="Ex: google-banho-tosa"
                />
              </div>
              <div className="office-field">
                <label>Valor Estimado (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newEstimatedValue}
                  onChange={(e) => setNewEstimatedValue(e.target.value)}
                  placeholder="150.00"
                />
              </div>
              <div
                className="office-field"
                style={{ justifyContent: 'flex-end' }}
              >
                <button type="submit" className="office-btn">
                  + Adicionar Lead
                </button>
              </div>
            </div>
          </form>
        </div>

        <div className="office-panel">
          <div className="office-panel-header">
            <h2>Funil de Leads ({leads.length})</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                }}
                placeholder="Buscar nome, telefone, pet..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                }}
                value={filterStage}
                onChange={(e) => setFilterStage(e.target.value)}
              >
                <option value="">Todos os estágios</option>
                {Object.entries(STAGE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                }}
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
              >
                <option value="">Todas as origens</option>
                {Object.entries(SOURCE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <p style={{ color: '#6b7280' }}>Carregando leads...</p>
          ) : leads.length === 0 ? (
            <p style={{ color: '#6b7280' }}>
              Nenhum lead encontrado com os filtros selecionados.
            </p>
          ) : (
            <div className="office-table-wrap">
              <table className="office-table">
                <thead>
                  <tr>
                    <th>Cliente / Pet</th>
                    <th>Contato</th>
                    <th>Interesse</th>
                    <th>Origem / Campanha</th>
                    <th>Estágio</th>
                    <th>Valor / Pedido Bling</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <strong>{lead.name}</strong>
                        {lead.petName && (
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            🐾 {lead.petName}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{lead.phone || '—'}</div>
                        {lead.email && (
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            {lead.email}
                          </div>
                        )}
                      </td>
                      <td>{lead.interest || '—'}</td>
                      <td>
                        <div>{SOURCE_LABELS[lead.source] || lead.source}</div>
                        {lead.utmCampaign && (
                          <div style={{ fontSize: 11, color: '#6b7280' }}>
                            UTM: <code>{lead.utmCampaign}</code>
                          </div>
                        )}
                      </td>
                      <td>
                        <select
                          value={lead.stage}
                          onChange={(e) =>
                            handleStageChange(
                              lead,
                              e.target.value as LeadStage,
                            )
                          }
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: '1px solid #d1d5db',
                            fontSize: 12,
                          }}
                        >
                          {Object.entries(STAGE_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div>
                          {formatBRL(
                            lead.convertedValue > 0
                              ? lead.convertedValue
                              : lead.estimatedValue,
                          )}
                        </div>
                        {lead.blingOrderNumber ? (
                          <div style={{ fontSize: 11, color: '#15803d' }}>
                            Pedido Bling #{lead.blingOrderNumber}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleLinkBlingOrder(lead)}
                            style={{
                              marginTop: 4,
                              background: 'none',
                              border: 'none',
                              color: '#2563eb',
                              fontSize: 11,
                              cursor: 'pointer',
                              padding: 0,
                              textDecoration: 'underline',
                            }}
                          >
                            Vincular Pedido Bling
                          </button>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="office-btn danger"
                          onClick={() => handleDelete(lead.id)}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
