import { useState, useEffect, useCallback } from 'react';
import { getPedidosVenda, getBlingIntegration, gerarRPSPedidos } from '../../services/blingApi';
import type { PedidoVenda } from '../../services/blingApi';
import './PedidosVenda.css';

interface PedidosVendaProps {
  onBack: () => void;
}

export const PedidosVenda = ({ onBack }: PedidosVendaProps) => {
  const [pedidos, setPedidos] = useState<PedidoVenda[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [filtroNumero, setFiltroNumero] = useState('');
  const [filtroDataInicial, setFiltroDataInicial] = useState('');
  const [filtroDataFinal, setFiltroDataFinal] = useState('');
  const [numeroInicial, setNumeroInicial] = useState<number | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loadingRPS, setLoadingRPS] = useState(false);
  const [rpsMessage, setRpsMessage] = useState('');

  // Buscar configuração do número inicial
  useEffect(() => {
    const carregarConfiguracao = async () => {
      try {
        const config = await getBlingIntegration();
        setNumeroInicial(config.initialOrderNumber ?? null);
      } catch (err) {
        console.error('Erro ao carregar configuração:', err);
      } finally {
        setLoadingConfig(false);
      }
    };
    carregarConfiguracao();
  }, []);

  const carregarPedidos = useCallback(async () => {
    if (loadingConfig) return;
    
    try {
      setLoading(true);
      setError('');
      
      const params: any = { pagina, limite: 100 }; // Buscar mais para filtrar localmente
      
      if (filtroNumero) {
        params.numero = parseInt(filtroNumero);
      }
      if (filtroDataInicial) {
        params.dataInicial = filtroDataInicial;
      }
      if (filtroDataFinal) {
        params.dataFinal = filtroDataFinal;
      }

      const response = await getPedidosVenda(params);
      let pedidosFiltrados = response.data || [];
      
      // Debug: ver situações dos pedidos
      console.log('🔵 Pedidos recebidos (ANTES do filtro):', pedidosFiltrados.map(p => ({ 
        numero: p.numero, 
        situacao: p.situacao,
        situacaoId: p.situacao?.id,
        situacaoIdType: typeof p.situacao?.id
      })));
      
      // Filtrar pedidos pelo número inicial configurado
      if (numeroInicial !== null && numeroInicial > 0) {
        pedidosFiltrados = pedidosFiltrados.filter(p => p.numero >= numeroInicial);
      }
      
      // Filtrar pedidos cancelados (situação 2) - comparar como string e número
      pedidosFiltrados = pedidosFiltrados.filter(p => {
        const situacaoId = p.situacao?.id;
        return situacaoId !== 2 && String(situacaoId) !== '2';
      });
      
      console.log('🟢 Pedidos APÓS filtro:', pedidosFiltrados.length);
      
      setPedidos(pedidosFiltrados);
      
      // Estimar total de páginas baseado nos resultados
      if (response.data && response.data.length === 100) {
        setTotalPaginas(Math.max(totalPaginas, pagina + 1));
      } else {
        setTotalPaginas(pagina);
      }
    } catch (err: any) {
      console.error('Erro ao carregar pedidos:', err);
      setError(err.message || 'Erro ao carregar pedidos de venda');
    } finally {
      setLoading(false);
    }
  }, [pagina, filtroNumero, filtroDataInicial, filtroDataFinal, numeroInicial, loadingConfig, totalPaginas]);

  useEffect(() => {
    if (!loadingConfig) {
      carregarPedidos();
    }
  }, [pagina, loadingConfig, carregarPedidos]);

  const handleFiltrar = (e: React.FormEvent) => {
    e.preventDefault();
    setPagina(1);
    carregarPedidos();
  };

  const handleLimparFiltros = () => {
    setFiltroNumero('');
    setFiltroDataInicial('');
    setFiltroDataFinal('');
    setPagina(1);
    setTimeout(() => carregarPedidos(), 0);
  };

  const formatarData = (data: string) => {
    if (!data) return '-';
    return new Date(data).toLocaleDateString('pt-BR');
  };

  const formatarValor = (valor: number) => {
    if (valor === undefined || valor === null) return 'R$ 0,00';
    return valor.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  };

  const getSituacaoClass = (situacao?: { id: number; valor: string }) => {
    if (!situacao) return 'situacao-padrao';
    
    const id = situacao.id;
    // Situações comuns do Bling
    if (id === 6 || id === 9) return 'situacao-atendido'; // Atendido/Finalizado
    if (id === 15) return 'situacao-em-andamento'; // Em andamento
    if (id === 12) return 'situacao-cancelado'; // Cancelado
    if (id === 24) return 'situacao-verificado'; // Verificado
    
    return 'situacao-padrao';
  };

  // Verifica se o pedido pode ser selecionado para gerar RPS
  const isSelectable = (pedido: PedidoVenda) => {
    // Não pode selecionar se já tem RPS emitido
    if (pedido.rpsStatus) return false;
    
    // Não pode selecionar se for situação 2 (cancelado)
    if (pedido.situacao?.id === 2 || String(pedido.situacao?.id) === '2') return false;
    
    // Não pode selecionar se for Consumidor Final
    const nomeCliente = pedido.contato?.nome?.toLowerCase() || '';
    if (nomeCliente.includes('consumidor final') || nomeCliente === 'consumidor final') {
      return false;
    }
    
    return true;
  };

  // Obter tooltip para checkbox desabilitado
  const getCheckboxTooltip = (pedido: PedidoVenda) => {
    if (pedido.rpsStatus) return 'RPS já emitido para este pedido';
    if (pedido.situacao?.id === 2 || String(pedido.situacao?.id) === '2') return 'Pedido cancelado';
    const nomeCliente = pedido.contato?.nome?.toLowerCase() || '';
    if (nomeCliente.includes('consumidor final')) return 'Não é possível emitir RPS para Consumidor Final';
    return '';
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // Só seleciona os pedidos que podem ser selecionados
      setSelectedIds(new Set(pedidos.filter(p => isSelectable(p)).map(p => p.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectItem = (id: number, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
  };

  const handleGerarRPS = async () => {
    if (selectedIds.size === 0) return;

    setLoadingRPS(true);
    setError('');
    setRpsMessage('');

    console.log('🟡 [handleGerarRPS] Iniciando geração de RPS');
    console.log('🟡 [handleGerarRPS] IDs selecionados:', Array.from(selectedIds));

    try {
      const pedidoIds = Array.from(selectedIds);
      console.log('🟡 [handleGerarRPS] Chamando gerarRPSPedidos com:', pedidoIds);
      const result = await gerarRPSPedidos(pedidoIds);
      console.log('🟢 [handleGerarRPS] Resultado:', result);

      // Mostrar mensagem de sucesso
      const sucessos = result.resultados.filter((r: any) => r.status === 'sucesso').length;
      const erros = result.resultados.filter((r: any) => r.status === 'erro').length;
      const ignorados = result.resultados.filter((r: any) => r.status === 'ignorado').length;

      let mensagem = `RPS gerado! `;
      if (sucessos > 0) mensagem += `${sucessos} sucesso(s). `;
      if (ignorados > 0) mensagem += `${ignorados} ignorado(s). `;
      if (erros > 0) mensagem += `${erros} erro(s).`;

      setRpsMessage(mensagem);
      setSelectedIds(new Set()); // Limpar seleção

      // Recarregar pedidos para mostrar status RPS atualizado
      await carregarPedidos();

      // Limpar mensagem após 5 segundos
      setTimeout(() => setRpsMessage(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar RPS');
    } finally {
      setLoadingRPS(false);
    }
  };

  const selectablePedidos = pedidos.filter(p => isSelectable(p));
  const allSelected = selectablePedidos.length > 0 && selectablePedidos.every(p => selectedIds.has(p.id));

  return (
    <div className="pedidos-container">
      <div className="pedidos-card">
        <div className="pedidos-header">
          <button className="back-button" onClick={onBack}>
            ← Voltar
          </button>
          <h1>Pedidos de Venda</h1>
          {numeroInicial !== null && numeroInicial > 0 && (
            <span className="numero-inicial-info">
              A partir do pedido #{numeroInicial}
            </span>
          )}
        </div>

        {/* Filtros */}
        <form className="filtros-form" onSubmit={handleFiltrar}>
          <div className="filtros-grid">
            <div className="filtro-grupo">
              <label htmlFor="filtroNumero">Número do Pedido</label>
              <input
                id="filtroNumero"
                type="text"
                value={filtroNumero}
                onChange={(e) => setFiltroNumero(e.target.value)}
                placeholder="Ex: 1234"
              />
            </div>
            <div className="filtro-grupo">
              <label htmlFor="filtroDataInicial">Data Inicial</label>
              <input
                id="filtroDataInicial"
                type="date"
                value={filtroDataInicial}
                onChange={(e) => setFiltroDataInicial(e.target.value)}
              />
            </div>
            <div className="filtro-grupo">
              <label htmlFor="filtroDataFinal">Data Final</label>
              <input
                id="filtroDataFinal"
                type="date"
                value={filtroDataFinal}
                onChange={(e) => setFiltroDataFinal(e.target.value)}
              />
            </div>
            <div className="filtro-acoes">
              <button type="submit" className="btn btn-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                Filtrar
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleLimparFiltros}>
                Limpar
              </button>
            </div>
          </div>
        </form>

        {/* Mensagens de erro */}
        {error && <div className="alert alert-error">{error}</div>}

        {/* Tabela de pedidos */}
        <div className="pedidos-table-container">
          {loading ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <p>Carregando pedidos...</p>
            </div>
          ) : pedidos.length === 0 ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 5H7C6.46957 5 5.96086 5.21071 5.58579 5.58579C5.21071 5.96086 5 6.46957 5 7V19C5 19.5304 5.21071 20.0391 5.58579 20.4142C5.96086 20.7893 6.46957 21 7 21H17C17.5304 21 18.0391 20.7893 18.4142 20.4142C18.7893 20.0391 19 19.5304 19 19V7C19 6.46957 18.7893 5.96086 18.4142 5.58579C18.0391 5.21071 17.5304 5 17 5H15" />
                <path d="M9 5C9 4.46957 9.21071 3.96086 9.58579 3.58579C9.96086 3.21071 10.4696 3 11 3H13C13.5304 3 14.0391 3.21071 14.4142 3.58579C14.7893 3.96086 15 4.46957 15 5C15 5.53043 14.7893 6.03914 14.4142 6.41421C14.0391 6.78929 13.5304 7 13 7H11C10.4696 7 9.96086 6.78929 9.58579 6.41421C9.21071 6.03914 9 5.53043 9 5Z" />
              </svg>
              <h3>Nenhum pedido encontrado</h3>
              <p>Não há pedidos de venda para exibir.</p>
            </div>
          ) : (
            <>
            {/* Barra de seleção - acima da tabela */}
            {selectedIds.size > 0 && (
              <div className="selection-info">
                <span>{selectedIds.size} pedido(s) selecionado(s)</span>
                <button
                  className="btn btn-rps"
                  onClick={handleGerarRPS}
                  disabled={loadingRPS}
                >
                  {loadingRPS ? 'Gerando RPS...' : `Gerar RPS (${selectedIds.size})`}
                </button>
              </div>
            )}

            {rpsMessage && (
              <div className="alert alert-success">
                {rpsMessage}
              </div>
            )}

            <table className="pedidos-table">
              <thead>
                <tr>
                  <th className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th>Número</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Situação</th>
                  <th>RPS</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((pedido) => {
                  const selectable = isSelectable(pedido);
                  const tooltip = getCheckboxTooltip(pedido);
                  
                  return (
                    <tr key={pedido.id} className={`${selectedIds.has(pedido.id) ? 'selected' : ''} ${!selectable ? 'disabled-row' : ''}`}>
                      <td className="checkbox-cell">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(pedido.id)}
                          onChange={(e) => handleSelectItem(pedido.id, e.target.checked)}
                          disabled={!selectable}
                          title={tooltip}
                        />
                      </td>
                      <td className="numero-cell">#{pedido.numero}</td>
                      <td>{formatarData(pedido.data)}</td>
                      <td className="cliente-cell">
                        {pedido.contato?.nome || pedido.contato?.tipoPessoa || '-'}
                      </td>
                      <td className="valor-cell">{formatarValor(pedido.total)}</td>
                      <td>
                        <span className={`situacao-badge ${getSituacaoClass(pedido.situacao)}`}>
                          {pedido.situacao?.valor || 'Pendente'}
                        </span>
                      </td>
                      <td>
                        {pedido.rpsStatus ? (
                          <span className={`rps-badge ${pedido.rpsStatus}`}>
                            {pedido.rpsStatus === 'erro' ? 'Erro' : (pedido.numeroRPS || pedido.rpsStatus)}
                          </span>
                        ) : (
                          <span className="rps-badge no-rps">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
          )}
        </div>

        {/* Paginação */}
        {!loading && pedidos.length > 0 && (
          <div className="paginacao">
            <button
              className="btn btn-pagina"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina === 1}
            >
              ← Anterior
            </button>
            <span className="pagina-info">Página {pagina}</span>
            <button
              className="btn btn-pagina"
              onClick={() => setPagina((p) => p + 1)}
              disabled={pedidos.length < 20}
            >
              Próxima →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PedidosVenda;
