export interface RpsTargetProgress {
  stage: 'preparando' | 'buscando' | 'gerando' | 'aguardando' | 'pausada' | 'concluida' | 'erro' | 'sem_pedidos';
  running: boolean;
  updatedAt: string;
  paginas: number;
  candidatos: number;
  examinados: number;
  gerados: number;
  ignorados: number;
  erros: number;
  pedidoAtual: number | null;
  ultimoRps: { pedido: string; numeroRps: string | null; valor: number; at: string } | null;
  eventos: { at: string; message: string; type: 'info' | 'success' | 'warning' | 'error' }[];
}

export function novoProgressoMeta(): RpsTargetProgress {
  return { stage: 'preparando', running: false, updatedAt: new Date().toISOString(),
    paginas: 0, candidatos: 0, examinados: 0, gerados: 0, ignorados: 0, erros: 0, pedidoAtual: null, ultimoRps: null, eventos: [] };
}
