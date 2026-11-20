import { useState, useEffect } from 'react';
import { officeApi, type McpInfoResponse } from '../../services/officeApi';
import './OfficeModules.css';

interface McpHubProps {
  onBack: () => void;
}

export function McpHub({ onBack }: McpHubProps) {
  const [info, setInfo] = useState<McpInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTool, setSelectedTool] = useState('get_business_overview');
  const [toolArgsJson, setToolArgsJson] = useState('{}');
  const [toolOutput, setToolOutput] = useState<string>('');
  const [runningTool, setRunningTool] = useState(false);

  useEffect(() => {
    officeApi
      .getMcpInfo()
      .then((res) => {
        setInfo(res);
        setError('');
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : 'Erro ao carregar informações do Hub MCP',
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const handleRunTool = async () => {
    setRunningTool(true);
    try {
      const parsed = toolArgsJson.trim() ? JSON.parse(toolArgsJson) : {};
      const result = await officeApi.testMcpTool(selectedTool, parsed);
      setToolOutput(JSON.stringify(result, null, 2));
      setError('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao executar tool MCP (verifique o JSON de argumentos)',
      );
    } finally {
      setRunningTool(false);
    }
  };

  const publicMcpUrl = `${window.location.origin}/api/mcp`;

  return (
    <div className="office-page">
      <header className="office-header">
        <div className="office-header-left">
          <button className="office-back-btn" onClick={onBack}>
            ← Voltar ao Painel
          </button>
          <div className="office-title-group">
            <h1>Hub MCP — Integração Agente Hermes & Bling ERP</h1>
            <p>
              Camada intermediária Model Context Protocol (JSON-RPC 2.0) entre o
              agente Hermes, o Bling ERP, o CRM e o Tráfego Pago
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

        {loading ? (
          <div className="office-panel">Carregando servidor MCP...</div>
        ) : (
          info && (
            <>
              <div className="office-kpi-grid">
                <div className="office-kpi-card green">
                  <div className="office-kpi-label">Servidor MCP</div>
                  <div className="office-kpi-value">{info.serverName}</div>
                  <div className="office-kpi-sub">
                    Protocolo {info.protocolVersion} · Ativo
                  </div>
                </div>
                <div className="office-kpi-card blue">
                  <div className="office-kpi-label">Tools Disponíveis</div>
                  <div className="office-kpi-value">{info.tools.length}</div>
                  <div className="office-kpi-sub">
                    Bling ERP + CRM + Tráfego Pago
                  </div>
                </div>
                <div className="office-kpi-card purple">
                  <div className="office-kpi-label">Contas Bling Ativas</div>
                  <div className="office-kpi-value">
                    {info.overview.erpBling.totals.activeAccounts}
                  </div>
                  <div className="office-kpi-sub">
                    {info.overview.erpBling.totals.emitidos} NFSe emitidas
                  </div>
                </div>
              </div>

              <div className="office-panel">
                <div className="office-panel-header">
                  <h2>Configuração para o Agente Hermes (Dokploy / MCP)</h2>
                </div>
                <p style={{ fontSize: 13, color: '#4b5563', marginTop: 0 }}>
                  Como o Hermes roda na mesma rede Docker (
                  <code>dokploy-network</code>) na VPS, você pode conectá-lo
                  diretamente via URL interna ou externa:
                </p>
                <pre className="office-code">{`{
  "mcpServers": {
    "vila-pet-office": {
      "type": "streamable-http",
      "url": "${info.internalDockerUrl}",
      "externalUrl": "${publicMcpUrl}",
      "headers": {
        "X-MCP-API-Key": "${info.apiKey}"
      }
    }
  }
}`}</pre>
              </div>

              <div className="office-panel">
                <div className="office-panel-header">
                  <h2>Testador Interativo de Tools do Hermes</h2>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 16,
                  }}
                >
                  <div className="office-field">
                    <label>Selecione a Tool MCP</label>
                    <select
                      value={selectedTool}
                      onChange={(e) => setSelectedTool(e.target.value)}
                    >
                      {info.tools.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                      {
                        info.tools.find((t) => t.name === selectedTool)
                          ?.description
                      }
                    </p>
                    <label style={{ marginTop: 8 }}>
                      Argumentos JSON (opcional)
                    </label>
                    <textarea
                      rows={4}
                      value={toolArgsJson}
                      onChange={(e) => setToolArgsJson(e.target.value)}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <button
                      type="button"
                      className="office-btn"
                      onClick={handleRunTool}
                      disabled={runningTool}
                      style={{ marginTop: 10 }}
                    >
                      {runningTool ? 'Executando...' : '▶ Executar Tool'}
                    </button>
                  </div>
                  <div className="office-field">
                    <label>Resposta para o Agente Hermes</label>
                    <pre
                      className="office-code"
                      style={{ minHeight: 190, maxHeight: 320, margin: 0 }}
                    >
                      {toolOutput ||
                        '// Clique em "Executar Tool" para inspecionar o retorno real que o Hermes recebe.'}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="office-panel">
                <div className="office-panel-header">
                  <h2>Catálogo de Tools Expostas ao Hermes ({info.tools.length})</h2>
                </div>
                <div className="office-table-wrap">
                  <table className="office-table">
                    <thead>
                      <tr>
                        <th>Tool</th>
                        <th>Descrição</th>
                        <th>Parâmetros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {info.tools.map((tool) => (
                        <tr key={tool.name}>
                          <td>
                            <code>{tool.name}</code>
                          </td>
                          <td>{tool.description}</td>
                          <td>
                            <code>
                              {Object.keys(
                                tool.inputSchema.properties || {},
                              ).join(', ') || '(sem parâmetros)'}
                            </code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
