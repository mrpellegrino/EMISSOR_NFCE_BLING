-- Script para alterar tipos de colunas na tabela pedidos_venda_rps
-- De integer para bigint para suportar IDs grandes da API Bling

-- Alterar tipo da coluna pedidoVendaId
ALTER TABLE pedidos_venda_rps
ALTER COLUMN "pedidoVendaId" TYPE bigint;

-- Alterar tipo da coluna numeroPedido
ALTER TABLE pedidos_venda_rps
ALTER COLUMN "numeroPedido" TYPE bigint;

-- Alterar tipo da coluna nfseId
ALTER TABLE pedidos_venda_rps
ALTER COLUMN "nfseId" TYPE bigint;

-- Verificar estrutura da tabela
\d pedidos_venda_rps
