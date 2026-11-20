# MCP financeiro do Vila Pet Office

O Office expõe `POST /api/mcp/finance` em Streamable HTTP. O endpoint usa a conexão OAuth Bling de cada conta Office. Todas as ferramentas consultam dados. Não existem ferramentas de pagamento, baixa, cobrança, alteração de categoria ou emissão de nota neste endpoint.

| Ferramenta | Consulta |
| --- | --- |
| `finance_list_accounts` | Contas autorizadas que pertencem ao usuário configurado |
| `finance_list_payables` e `finance_list_receivables` | Títulos por vencimento, emissão ou liquidação, com paginação |
| `finance_get_payable` e `finance_get_receivable` | Saldo, competência, categoria e referências de borderô do título |
| `finance_list_categories` | Categorias financeiras e suas categorias pai |
| `finance_list_cash_accounts` | Portadores e contas financeiras cadastradas |
| `finance_get_settlement` | Data e valores de um borderô, que pode agrupar várias baixas |

Nas listas, continue até `proximaPagina` ser nula. Saldo e competência podem vir nulos na listagem e devem ser obtidos no detalhe. Consulte títulos parciais antes de somar o saldo. Identifique os borderôs por conta e ID para evitar dupla contagem. A relação de portadores não fornece saldo bancário ou extrato. Uma DRE completa ainda depende de competência, mapa de categorias, custos e outros dados contábeis.

## Configuração no Office

Defina as variáveis no ambiente do backend gerenciado.

- `OFFICE_FINANCE_MCP_KEY`: segredo exclusivo gerado aleatoriamente com pelo menos 32 caracteres. Nunca use a chave do MCP legado.
- `OFFICE_FINANCE_MCP_USER_ID`: ID do usuário Office a que as contas Bling pertencem.
- `OFFICE_FINANCE_MCP_ACCOUNT_IDS`: IDs Office das contas autorizadas, separados por vírgula.

A rota retorna 404 sem configuração válida e 401 com credencial incorreta. Uma conta também é recusada se não pertencer ao usuário configurado. Caso alguma consulta retorne erro de autorização do Bling, confirme os módulos autorizados no aplicativo OAuth daquela conta antes de reautorizá-la pelo Office.

Se o painel do deploy estiver acessível somente por HTTP, prefira um arquivo privado provisionado por SSH. Sem as variáveis acima, o backend lê `/run/office-finance-mcp/config.json`, que deve ser um arquivo regular com permissões `0600` e três campos de texto: `key`, `userId` e `accountIds`. Monte apenas esse arquivo no serviço e mantenha o segredo fora do repositório e do painel.

## Configuração no Hermes

No perfil `vilapetbrasil`, grave o mesmo segredo como `OFFICE_FINANCE_MCP_KEY` no arquivo `.env` privado. Acrescente este bloco ao `config.yaml` do perfil, preservando os demais servidores configurados:

```yaml
mcp_servers:
  office_financeiro:
    url: http://office-backend-sy1nl0:3000/api/mcp/finance
    headers:
      Authorization: "Bearer ${OFFICE_FINANCE_MCP_KEY}"
    tools:
      include:
        - finance_list_accounts
        - finance_list_payables
        - finance_list_receivables
        - finance_get_payable
        - finance_get_receivable
        - finance_list_categories
        - finance_list_cash_accounts
        - finance_get_settlement
```

Use a rede interna compartilhada entre Office e Hermes. Execute `hermes -p vilapetbrasil mcp test office_financeiro` e confirme as oito ferramentas. Depois, em sessão nova, chame `finance_list_accounts` e faça uma consulta paginada curta em cada conta autorizada. Verifique o retorno e os escopos antes de usar os dados para um fechamento. Para interromper o acesso, desative o servidor no perfil ou retire a configuração de chave do Office.
