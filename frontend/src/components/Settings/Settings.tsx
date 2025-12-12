import { useState, useEffect } from 'react';
import type { BlingIntegrationStatus } from '../../services/blingApi';
import {
  getBlingIntegration,
  saveBlingIntegration,
  deactivateBlingIntegration,
  removeBlingIntegration,
  setInitialOrderNumber,
} from '../../services/blingApi';
import './Settings.css';

interface SettingsProps {
  onBack: () => void;
}

export const Settings = ({ onBack }: SettingsProps) => {
  const [integration, setIntegration] = useState<BlingIntegrationStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [initialOrderNumber, setInitialOrderNumberState] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadIntegration();

    // Verifica se retornou do OAuth
    const urlParams = new URLSearchParams(window.location.search);
    const blingStatus = urlParams.get('bling');

    if (blingStatus === 'success') {
      setSuccess('Integração com o Bling ativada com sucesso!');
      window.history.replaceState({}, '', '/settings');
      loadIntegration();
    } else if (blingStatus === 'error') {
      setError('Erro ao autorizar integração com o Bling');
      window.history.replaceState({}, '', '/settings');
    }
  }, []);

  const loadIntegration = async () => {
    try {
      setLoading(true);
      const data = await getBlingIntegration();
      setIntegration(data);
      if (data.clientId) {
        setClientId(data.clientId);
      }
      if (typeof data.initialOrderNumber === 'number') {
        setInitialOrderNumberState(data.initialOrderNumber);
      } else {
        setInitialOrderNumberState('');
      }
    } catch (err) {
      setError('Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      return;
    }

    try {
      setSaving(true);
      setError('');
      const initNumber = initialOrderNumber === '' ? null : Number(initialOrderNumber);
      await saveBlingIntegration(clientId.trim(), clientSecret.trim(), initNumber);
      setSuccess('Configuração salva automaticamente');
      // Não limpamos o secret aqui para permitir edição contínua
      // Mas recarregamos para atualizar status se necessário
      const data = await getBlingIntegration();
      setIntegration(data);
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar configuração');
    } finally {
      setSaving(false);
    }
  };

  // Auto-save com debounce
  useEffect(() => {
    // Não salvar na montagem inicial ou se campos estiverem vazios
    if (loading || !clientId || !clientSecret) return;

    const timeoutId = setTimeout(() => {
      saveSettings();
    }, 1000); // Espera 1 segundo após parar de digitar

    return () => clearTimeout(timeoutId);
  }, [clientId, clientSecret]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveSettings();
    setSuccess('Configuração salva com sucesso!');
    setClientSecret(''); // Limpa por segurança apenas no save manual
  };

  const handleAuthorize = async () => {
    try {
      setError('');
      // Redireciona diretamente para o endpoint do backend, que por sua vez redireciona para o Bling
      window.location.href = 'http://localhost:3000/api/bling/authorize';
    } catch (err: any) {
      setError(err.message || 'Erro ao iniciar autorização');
    }
  };

  const handleInitialOrderSave = async () => {
    try {
      console.log('🔵 [DEBUG] Iniciando handleInitialOrderSave');
      console.log('🔵 [DEBUG] initialOrderNumber:', initialOrderNumber);
      
      setError('');
      const value = initialOrderNumber === '' ? null : Number(initialOrderNumber);
      console.log('🔵 [DEBUG] value calculado:', value);
      
      if (value !== null && (!Number.isInteger(value) || value < 0)) {
        console.log('🔴 [DEBUG] Validação falhou - não é inteiro positivo');
        setError('O número inicial deve ser um inteiro positivo ou vazio para limpar');
        return;
      }
      
      console.log('🔵 [DEBUG] Chamando setInitialOrderNumber com:', value);
      const result = await setInitialOrderNumber(value);
      console.log('🟢 [DEBUG] Resultado da API:', result);
      
      setSuccess('Número inicial de pedido atualizado');
      loadIntegration();
    } catch (err: any) {
      console.error('🔴 [DEBUG] Erro capturado:', err);
      console.error('🔴 [DEBUG] Mensagem do erro:', err.message);
      console.error('🔴 [DEBUG] Stack:', err.stack);
      setError(err.message || 'Erro ao salvar número inicial');
    }
  };

  const handleDeactivate = async () => {
    if (!confirm('Deseja realmente desativar a integração?')) return;

    try {
      setError('');
      await deactivateBlingIntegration();
      setSuccess('Integração desativada');
      loadIntegration();
    } catch (err: any) {
      setError(err.message || 'Erro ao desativar integração');
    }
  };

  const handleRemove = async () => {
    if (!confirm('Deseja realmente remover a integração? Todos os dados serão perdidos.')) return;

    try {
      setError('');
      await removeBlingIntegration();
      setSuccess('Integração removida');
      setClientId('');
      setClientSecret('');
      setIntegration(null);
      loadIntegration();
    } catch (err: any) {
      setError(err.message || 'Erro ao remover integração');
    }
  };

  if (loading) {
    return (
      <div className="settings-container">
        <div className="settings-card">
          <div className="loading">Carregando...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="settings-card">
        <div className="settings-header">
          <button className="back-button" onClick={onBack}>
            ← Voltar
          </button>
          <h1>Configurações</h1>
        </div>

        <div className="settings-section">
          <div className="section-header">
            <div className="section-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="section-title">
              <h2>Integração Bling ERP</h2>
              <p>Configure sua conta do Bling para emissão de NFC-e</p>
            </div>
            <div className={`status-badge ${integration?.isActive ? 'active' : 'inactive'}`}>
              {integration?.isActive ? 'Ativo' : 'Inativo'}
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <form onSubmit={handleSave} className="integration-form">
            <div className="form-group">
              <label htmlFor="clientId">Client ID</label>
              <input
                id="clientId"
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Digite o Client ID do seu aplicativo Bling"
              />
              <span className="help-text">
                Encontre nas configurações do seu aplicativo no Bling
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="clientSecret">Client Secret</label>
              <input
                id="clientSecret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={integration?.hasClientSecret ? '••••••••••••' : 'Digite o Client Secret'}
              />
              <span className="help-text">
                {integration?.hasClientSecret
                  ? 'Secret já configurado. Deixe em branco para manter o atual.'
                  : 'Mantenha este valor em segurança'}
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="initialOrderNumber">Número inicial do pedido de venda</label>
              <input
                id="initialOrderNumber"
                type="number"
                min={0}
                step={1}
                value={initialOrderNumber}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    setInitialOrderNumberState('');
                  } else {
                    const n = Number(v);
                    if (Number.isInteger(n) && n >= 0) {
                      setInitialOrderNumberState(n);
                    }
                  }
                }}
                placeholder="Ex.: 1000 (opcional)"
              />
              <span className="help-text">
                Define o ponto de partida para sincronizar pedidos de venda do Bling.
                Deixe vazio para sincronizar desde o início.
              </span>
              <div className="form-actions inline">
                <button type="button" className="btn" onClick={handleInitialOrderSave}>
                  Salvar Número Inicial
                </button>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar Configuração'}
              </button>
              {saving && <span className="saving-indicator">💾 Salvando alterações...</span>}
            </div>
          </form>

          {integration?.configured && (
            <div className="authorization-section">
              <div className="divider">
                <span>Autorização OAuth 2.0</span>
              </div>

              {!integration.isActive ? (
                <div className="auth-action">
                  <p>Após salvar as credenciais, autorize o acesso à sua conta Bling:</p>
                  <button
                    className="btn btn-authorize"
                    onClick={handleAuthorize}
                    disabled={!integration.configured}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                      <polyline points="10 17 15 12 10 7" />
                      <line x1="15" y1="12" x2="3" y2="12" />
                    </svg>
                    Autorizar no Bling
                  </button>
                </div>
              ) : (
                <div className="auth-status">
                  <div className="status-info">
                    <div className="status-item">
                      <span className="label">Status:</span>
                      <span className="value success">Conectado</span>
                    </div>
                    {integration.tokenExpiresAt && (
                      <div className="status-item">
                        <span className="label">Token expira em:</span>
                        <span className="value">
                          {new Date(integration.tokenExpiresAt).toLocaleString('pt-BR')}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="auth-actions">
                    <button className="btn btn-warning" onClick={handleDeactivate}>
                      Desativar
                    </button>
                    <button className="btn btn-danger" onClick={handleRemove}>
                      Remover
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="help-section">
            <h3>Como obter as credenciais?</h3>
            <ol>
              <li>Acesse o <a href="https://www.bling.com.br/login" target="_blank" rel="noopener noreferrer">Bling</a></li>
              <li>Vá em <strong>Preferências → Integrações → API</strong></li>
              <li>Crie um novo aplicativo ou use um existente</li>
              <li>Copie o <strong>Client ID</strong> e <strong>Client Secret</strong></li>
              <li>Configure a URL de callback: <code>http://localhost:3000/api/bling/callback</code></li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};
