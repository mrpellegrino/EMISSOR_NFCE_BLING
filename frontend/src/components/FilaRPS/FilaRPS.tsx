import { useState, useEffect, useCallback } from 'react';
import { getFilaRPS, enviarNFSeParaPrefeitura, sincronizarStatusNFSe } from '../../services/blingApi';
import './FilaRPS.css';

interface FilaRPSProps {
  onBack: () => void;
}

interface ItemFila {
  id: string;
  numeroRPS: string;
  numeroPedido: string;
  numeroNFSe: string | null;
  cliente: string;
  valor: number;
  dataInclusao: string;
  status: 'pendente' | 'processando' | 'emitido' | 'erro';
  mensagemErro?: string;
}

function FilaRPS({ onBack }: FilaRPSProps) {
  const [itens, setItens] = useState<ItemFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [processando, setProcessando] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<string | null>(null);

  const carregarFila = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await getFilaRPS({ pagina: 1, limite: 10000 });

      // Transformar dados da API para o formato ItemFila
      const itensTransformados: ItemFila[] = response.data.map((item: any) => ({
        id: item.id.toString(),
        numeroRPS: item.numeroRPS || '-',
        numeroPedido: item.numeroPedido.toString(),
        numeroNFSe: item.numeroNFSe || null,
        cliente: item.nomeCliente,
        valor: parseFloat(item.valorTotal),
        dataInclusao: item.createdAt,
        status: item.status as 'pendente' | 'processando' | 'emitido' | 'erro',
        mensagemErro: item.mensagemErro
      }));

      setItens(itensTransformados);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar fila');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregarFila();
  }, [carregarFila]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // Seleciona todos que podem ser selecionados (usa itensFiltrados para respeitar o filtro atual)
      const selecionaveis = itensFiltrados
        .filter(i => !(i.status === 'emitido' && i.numeroNFSe)) // Exclui emitidos COM número
        .map(i => i.id);
      setSelectedIds(new Set(selecionaveis));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectItem = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
  };

  const handleProcessarSelecionados = async () => {
    if (selectedIds.size === 0) return;
    
    setProcessando(true);
    setError(null);
    try {
      // Converter IDs de string para number
      const rpsIds = Array.from(selectedIds).map(id => parseInt(id));
      console.log('Enviando NFSe para prefeitura:', rpsIds);
      
      const resultado = await enviarNFSeParaPrefeitura(rpsIds);
      console.log('Resultado:', resultado);
      
      // Recarregar lista
      await carregarFila();
      setSelectedIds(new Set());
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar NFSe');
    } finally {
      setProcessando(false);
    }
  };

  const handleSincronizar = async () => {
    setProcessando(true);
    setError(null);
    try {
      console.log('Sincronizando status das NFSe...');
      const resultado = await sincronizarStatusNFSe();
      console.log('Resultado sincronização:', resultado);
      
      // Recarregar lista
      await carregarFila();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao sincronizar');
    } finally {
      setProcessando(false);
    }
  };

  const formatarData = (data: string) => {
    return new Date(data).toLocaleString('pt-BR');
  };

  const formatarValor = (valor: number) => {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const getStatusLabel = (status: string, numeroNFSe: string | null) => {
    // Se está emitido mas não tem número de nota, mostrar como pendente
    if (status === 'emitido' && !numeroNFSe) {
      return 'Pendente';
    }
    
    const labels: Record<string, string> = {
      'pendente': 'Pendente',
      'processando': 'Processando',
      'emitido': 'Emitido',
      'erro': 'Erro'
    };
    return labels[status] || status;
  };
  
  // Função para obter a classe CSS do status (considerando emitidos sem número)
  const getStatusClass = (status: string, numeroNFSe: string | null) => {
    // Se está emitido mas não tem número de nota, mostrar como pendente
    if (status === 'emitido' && !numeroNFSe) {
      return 'pendente';
    }
    return status;
  };

  const estatisticas = {
    // Pendentes inclui: status pendente OU status emitido SEM número de nota
    pendentes: itens.filter(i => i.status === 'pendente' || (i.status === 'emitido' && !i.numeroNFSe)).length,
    processando: itens.filter(i => i.status === 'processando').length,
    // Emitidos são apenas os que TÊM número de nota
    emitidos: itens.filter(i => i.status === 'emitido' && i.numeroNFSe).length,
    erros: itens.filter(i => i.status === 'erro').length
  };

  // Função para alternar filtro
  const toggleFiltro = (status: string) => {
    setFiltroStatus(prev => prev === status ? null : status);
  };

  // Itens filtrados pelo status selecionado
  const itensFiltrados = filtroStatus 
    ? itens.filter(i => {
        // Lógica especial: emitidos sem número são tratados como pendentes
        const statusEfetivo = (i.status === 'emitido' && !i.numeroNFSe) ? 'pendente' : i.status;
        
        if (filtroStatus === 'pendente') {
          // Mostrar pendentes E emitidos sem número
          return statusEfetivo === 'pendente';
        }
        if (filtroStatus === 'emitido') {
          // Mostrar apenas emitidos COM número
          return i.status === 'emitido' && i.numeroNFSe;
        }
        // Para outros filtros (processando, erro), usar status original
        return i.status === filtroStatus;
      })
    : itens;

  // Função para verificar se um item pode ser selecionado
  // Pode selecionar: pendente, processando, erro, ou emitido SEM número de nota
  const podeSelecionar = (item: ItemFila) => {
    // Se é emitido COM número de nota, não pode selecionar
    if (item.status === 'emitido' && item.numeroNFSe) {
      return false;
    }
    // Todos os outros podem ser selecionados
    return true;
  };

  // Itens que podem ser selecionados
  const itensSelecionaveis = itensFiltrados.filter(podeSelecionar);
  const allSelecionaveisSelected = itensSelecionaveis.length > 0 && 
    itensSelecionaveis.every(i => selectedIds.has(i.id));

  return (
    <div className="fila-rps-container">
      <header className="fila-rps-header">
        <div className="header-left">
          <button className="back-button" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 19L5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Voltar
          </button>
          <div className="header-title">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 4H18C18.5304 4 19.0391 4.21071 19.4142 4.58579C19.7893 4.96086 20 5.46957 20 6V20C20 20.5304 19.7893 21.0391 19.4142 21.4142C19.0391 21.7893 18.5304 22 18 22H6C5.46957 22 4.96086 21.7893 4.58579 21.4142C4.21071 21.0391 4 20.5304 4 20V6C4 5.46957 4.21071 4.96086 4.58579 4.58579C4.96086 4.21071 5.46957 4 6 4H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M15 2H9C8.44772 2 8 2.44772 8 3V5C8 5.55228 8.44772 6 9 6H15C15.5523 6 16 5.55228 16 5V3C16 2.44772 15.5523 2 15 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 11V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 14H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Fila Emissão RPS</span>
          </div>
        </div>
      </header>

      <main className="fila-rps-main">
        {/* Estatísticas */}
        <div className="fila-rps-stats">
          <div 
            className={`stat-item clickable ${filtroStatus === 'pendente' ? 'active' : ''}`}
            onClick={() => toggleFiltro('pendente')}
            title="Clique para filtrar por pendentes"
          >
            <div className="icon pending">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="info">
              <span className="value">{estatisticas.pendentes}</span>
              <span className="label">Pendentes</span>
            </div>
          </div>

          <div 
            className={`stat-item clickable ${filtroStatus === 'processando' ? 'active' : ''}`}
            onClick={() => toggleFiltro('processando')}
            title="Clique para filtrar por processando"
          >
            <div className="icon processing">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M23 4V10H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M1 20V14H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3.51 9C4.01717 7.56678 4.87913 6.2854 6.01547 5.27542C7.1518 4.26543 8.52547 3.55976 10.0083 3.22426C11.4911 2.88875 13.0348 2.93434 14.4952 3.35677C15.9556 3.77921 17.2853 4.56471 18.36 5.64L23 10M1 14L5.64 18.36C6.71475 19.4353 8.04437 20.2208 9.50481 20.6432C10.9652 21.0657 12.5089 21.1112 13.9917 20.7757C15.4745 20.4402 16.8482 19.7346 17.9845 18.7246C19.1209 17.7146 19.9828 16.4332 20.49 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="info">
              <span className="value">{estatisticas.processando}</span>
              <span className="label">Processando</span>
            </div>
          </div>

          <div 
            className={`stat-item clickable ${filtroStatus === 'emitido' ? 'active' : ''}`}
            onClick={() => toggleFiltro('emitido')}
            title="Clique para filtrar por emitidos"
          >
            <div className="icon success">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85781 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 4L12 14.01L9 11.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="info">
              <span className="value">{estatisticas.emitidos}</span>
              <span className="label">Emitidos</span>
            </div>
          </div>

          <div 
            className={`stat-item clickable ${filtroStatus === 'erro' ? 'active' : ''}`}
            onClick={() => toggleFiltro('erro')}
            title="Clique para filtrar por erros"
          >
            <div className="icon error">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M15 9L9 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="info">
              <span className="value">{estatisticas.erros}</span>
              <span className="label">Com Erro</span>
            </div>
          </div>
        </div>

        {/* Barra de Ações */}
        <div className="actions-bar">
          <div className="actions-left">
            <button 
              className="action-btn primary" 
              onClick={handleProcessarSelecionados}
              disabled={selectedIds.size === 0 || processando}
            >
              {processando ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="loading">
                    <path d="M23 4V10H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Processando...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Emitir Selecionados ({selectedIds.size})
                </>
              )}
            </button>
            
            <button 
              className="action-btn secondary" 
              onClick={handleSincronizar}
              disabled={processando}
              title="Sincronizar status das NFSe com o Bling"
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M23 4V10H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M1 20V14H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3.51 9C4.01717 7.56678 4.87913 6.2854 6.01547 5.27542C7.1518 4.26543 8.52547 3.55976 10.0083 3.22426C11.4911 2.88875 13.0348 2.93434 14.4952 3.35677C15.9556 3.77921 17.2853 4.56471 18.36 5.64L23 10M1 14L5.64 18.36C6.71475 19.4353 8.04437 20.2208 9.50481 20.6432C10.9652 21.0657 12.5089 21.1112 13.9917 20.7757C15.4745 20.4402 16.8482 19.7346 17.9845 18.7246C19.1209 17.7146 19.9828 16.4332 20.49 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Sincronizar Status
            </button>
          </div>

          <button 
            className={`refresh-btn ${loading ? 'loading' : ''}`} 
            onClick={carregarFila}
            disabled={loading}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M23 4V10H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1 20V14H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3.51 9C4.01717 7.56678 4.87913 6.2854 6.01547 5.27542C7.1518 4.26543 8.52547 3.55976 10.0083 3.22426C11.4911 2.88875 13.0348 2.93434 14.4952 3.35677C15.9556 3.77921 17.2853 4.56471 18.36 5.64L23 10M1 14L5.64 18.36C6.71475 19.4353 8.04437 20.2208 9.50481 20.6432C10.9652 21.0657 12.5089 21.1112 13.9917 20.7757C15.4745 20.4402 16.8482 19.7346 17.9845 18.7246C19.1209 17.7146 19.9828 16.4332 20.49 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Atualizar
          </button>
        </div>

        {/* Tabela */}
        <div className="fila-rps-table-container">
          {loading ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <span>Carregando fila...</span>
            </div>
          ) : error ? (
            <div className="error-container">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M15 9L9 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p>{error}</p>
              <button className="action-btn secondary" onClick={carregarFila}>
                Tentar novamente
              </button>
            </div>
          ) : itens.length === 0 ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 4H18C18.5304 4 19.0391 4.21071 19.4142 4.58579C19.7893 4.96086 20 5.46957 20 6V20C20 20.5304 19.7893 21.0391 19.4142 21.4142C19.0391 21.7893 18.5304 22 18 22H6C5.46957 22 4.96086 21.7893 4.58579 21.4142C4.21071 21.0391 4 20.5304 4 20V6C4 5.46957 4.21071 4.96086 4.58579 4.58579C4.96086 4.21071 5.46957 4 6 4H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 2H9C8.44772 2 8 2.44772 8 3V5C8 5.55228 8.44772 6 9 6H15C15.5523 6 16 5.55228 16 5V3C16 2.44772 15.5523 2 15 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h3>Fila Vazia</h3>
              <p>Não há itens na fila de emissão de RPS</p>
            </div>
          ) : (
            <table className="fila-rps-table">
              <thead>
                <tr>
                  <th className="checkbox-cell">
                    <input 
                      type="checkbox" 
                      checked={allSelecionaveisSelected}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      disabled={itensSelecionaveis.length === 0}
                    />
                  </th>
                  <th>Nº RPS</th>
                  <th>Cliente</th>
                  <th>Nº Pedido</th>
                  <th>Nº Nota</th>
                  <th>Valor</th>
                  <th>Data Inclusão</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {itensFiltrados.map((item) => (
                  <tr key={item.id} className={selectedIds.has(item.id) ? 'selected' : ''}>
                    <td className="checkbox-cell">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(item.id)}
                        onChange={(e) => handleSelectItem(item.id, e.target.checked)}
                        disabled={!podeSelecionar(item)}
                      />
                    </td>
                    <td className="numero">{item.numeroRPS}</td>
                    <td>{item.cliente}</td>
                    <td className="numero">{item.numeroPedido}</td>
                    <td className="numero">{item.numeroNFSe || '-'}</td>
                    <td>{formatarValor(item.valor)}</td>
                    <td>{formatarData(item.dataInclusao)}</td>
                    <td>
                      <span className={`status-badge ${getStatusClass(item.status, item.numeroNFSe)}`}>
                        {getStatusLabel(item.status, item.numeroNFSe)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

export { FilaRPS };
