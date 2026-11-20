import type { MetaRpsStatus } from '../../services/blingApi';
import { maskCurrency } from '../../services/currency';
import './MetaRpsPanel.css';

interface Props {
  meta: MetaRpsStatus | null;
  valorAlvo: string;
  onValorAlvo: (value: string) => void;
  onIniciar: () => void;
  onPausar: () => void;
  salvando: boolean;
  erro: string;
  desconectado: boolean;
  atualizadoEm: number | null;
}

const moeda = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (value: string | number) => new Date(value).toLocaleTimeString('pt-BR');
const estados: Record<string, string> = {
  ativa: 'Em andamento', pausada: 'Pausada', concluida: 'Alvo ultrapassado',
  revisao: 'Revisão necessária', sem_pedidos: 'Sem pedidos elegíveis',
};

export function MetaRpsPanel({ meta, valorAlvo, onValorAlvo, onIniciar, onPausar, salvando, erro, desconectado, atualizadoEm }: Props) {
  const ativo = meta?.status === 'ativa';
  const p = meta?.progress;
  const restante = meta?.target == null ? null : Math.max(0, meta.target - meta.valorGerado);
  const percentual = meta?.target ? Math.min(100, meta.valorGerado / meta.target * 100) : 0;
  const etapa = desconectado ? 'Sem conexão com o servidor' : p?.stage === 'buscando'
    ? `Buscando pedidos · ${p.paginas} página(s) carregada(s)`
    : p?.stage === 'gerando' ? `Gerando RPS do pedido #${p.pedidoAtual}`
    : p?.stage === 'erro' ? 'O processamento precisa de atenção'
    : p?.stage === 'preparando' ? 'Preparando a geração'
    : ativo ? 'Aguardando o próximo pedido'
    : estados[meta?.status || ''] || 'Defina um alvo para começar';
  const espera = p ? Math.floor((Date.now() - new Date(p.updatedAt).getTime()) / 1000) : 0;

  return <section className="meta-panel" aria-labelledby="meta-panel-title">
    <header className="meta-panel-header">
      <div><h2 id="meta-panel-title">Geração de RPS por valor-alvo</h2><p>Acompanhe a preparação dos RPS antes de enviar as notas.</p></div>
      <span className={`meta-status ${desconectado || p?.stage === 'erro' || meta?.status === 'revisao' ? 'attention' : ativo ? 'active' : ''}`}>
        <i aria-hidden="true" />{desconectado ? 'Sem conexão' : estados[meta?.status || ''] || 'Pronto para iniciar'}
      </span>
    </header>
    <div className="meta-metrics">
      <div><span>Total de RPS gerados</span><strong>{meta ? moeda(meta.valorGerado) : 'Carregando…'}</strong><small>Todo o histórico desta conta</small></div>
      <div><span>Valor-alvo</span><strong>{meta?.target != null ? moeda(meta.target) : '—'}</strong><small>Gera até ultrapassar este valor</small></div>
      <div><span>Falta para o alvo</span><strong>{restante != null ? moeda(restante) : '—'}</strong><small>{meta?.status === 'concluida' ? 'Geração finalizada' : restante === 0 ? 'O próximo RPS ultrapassa o alvo' : 'Inclui os RPS que aguardam envio'}</small></div>
    </div>
    {meta?.target != null && <div className="meta-progress">
      <div><span>Progresso do valor-alvo</span><b>{percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</b></div>
      <progress aria-label="Progresso do valor-alvo" max={100} value={percentual} />
    </div>}
    <div className="meta-live">
      <div className="meta-stage" role="status"><i className={ativo && !desconectado && p?.stage !== 'erro' ? 'meta-spinner' : 'meta-stage-dot'} aria-hidden="true" /><div><strong>{etapa}</strong>
        <p>{p?.stage === 'buscando' ? `${p.candidatos} pedido(s) candidato(s) encontrado(s). A busca inicial percorre todas as páginas para começar pelos mais antigos.`
          : p?.stage === 'gerando' ? espera >= 10 ? `Aguardando resposta do Bling há ${espera}s. O próximo pedido começa após esta criação.` : 'Consultando os dados do pedido e preparando o RPS no Bling.'
          : meta?.message || 'O envio das notas é controlado na Fila de RPS.'}</p></div></div>
      <span className="meta-sync">{desconectado ? 'Tentando reconectar…' : atualizadoEm ? `Sincronizado às ${hora(atualizadoEm)}` : 'Conectando…'}</span>
    </div>
    {p && <div className="meta-run-counts"><span><b>{p.gerados}</b> gerados nesta execução</span><span><b>{p.examinados}</b> pedidos verificados</span><span><b>{p.ignorados}</b> ignorados</span><span><b>{p.erros}</b> com erro</span></div>}
    {p?.ultimoRps && <div className="meta-last"><span className="meta-check" aria-hidden="true">✓</span><div><strong>Último RPS gerado {p.ultimoRps.numeroRps ? `#${p.ultimoRps.numeroRps}` : ''}</strong><span>Pedido #{p.ultimoRps.pedido} · {moeda(p.ultimoRps.valor)} · {hora(p.ultimoRps.at)}</span></div></div>}
    <form className="meta-controls" onSubmit={e => { e.preventDefault(); onIniciar(); }}>
      <div><label htmlFor="valor-alvo">Valor-alvo (R$)</label><input id="valor-alvo" type="text" inputMode="decimal" placeholder="R$ 0,00" value={valorAlvo} onChange={e => { if (e.target.value.replace(/\D/g, '').length <= 12) onValorAlvo(maskCurrency(e.target.value)); }} disabled={ativo || salvando} /></div>
      {ativo ? <button type="button" className="meta-pause" disabled={salvando} onClick={onPausar}>{salvando ? 'Aguardando operação atual…' : 'Pausar geração'}</button>
        : <button type="submit" disabled={salvando || !meta || desconectado}>{salvando ? 'Iniciando…' : 'Gerar RPS até o alvo'}</button>}
      <a href="/fila-rps">Abrir fila de RPS →</a>
    </form>
    {erro && <p className="meta-error" role="alert">{erro}</p>}
    {meta?.status === 'revisao' && meta.message && <p className="meta-error" role="alert">{meta.message}</p>}
    {p && p.eventos.length > 0 && <details className="meta-activity"><summary>Atividade recente</summary><ol>{p.eventos.map((event, i) => <li key={`${event.at}-${i}`} className={event.type}><time>{hora(event.at)}</time><span>{event.message}</span></li>)}</ol></details>}
    {(meta?.falhas?.length ?? 0) > 0 && <details className="meta-activity meta-failures" open>
      <summary>{meta!.falhas.length} pedido(s) para revisão · a geração continua com os demais</summary>
      <p>Os pedidos abaixo não serão tentados novamente automaticamente. Confira os dados e, se a criação ficou sem confirmação, verifique no Bling antes de tentar de novo.</p>
      <ol>{meta!.falhas.slice(-8).reverse().map(falha => <li className="error" key={falha.pedidoId}><time>{hora(falha.at)}</time><span><b>Pedido #{falha.numeroPedido}</b> · {falha.mensagem}</span></li>)}</ol>
      {meta!.falhas.length > 8 && <p>Mostrando os 8 erros mais recentes.</p>}
    </details>}
    <footer>A meta gera RPS e pausa o envio automático. Envie as notas pela fila quando desejar.</footer>
  </section>;
}
