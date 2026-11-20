# Contas Bling independentes

Após entrar no sistema, use **Adicionar conta**, informe um nome e configure o Client ID, o Client Secret e o ID da forma de pagamento daquela empresa. Clique em **Salvar Configuração** e autorize o acesso no Bling. Repita para cada conta.

O seletor permanece nas telas de configurações, pedidos, painel e fila de RPS. A seleção é lembrada por usuário e por aba do navegador. Ao trocar, os filtros e seleções são reiniciados e as requisições da tela anterior são canceladas. Uma emissão já recebida pelo servidor continua vinculada à conta original.

Cada conta guarda suas credenciais, tokens OAuth, número inicial de pedido, código de serviço, parcela, forma de pagamento e histórico de RPS. Os endpoints exigem login e o cabeçalho X-Account-Id; o servidor confere o proprietário. A exceção é o callback OAuth, protegido por state de uso único, com validade de dez minutos e vínculo à conta. Desativar ou remover credenciais não apaga o histórico.

## Atualização da instalação existente

O projeto continua usando a sincronização de schema do TypeORM já existente. Ao iniciar o backend, ela adiciona os campos por conta e substitui a unicidade global do pedido pela combinação conta + pedido. Faça backup do PostgreSQL antes de atualizar uma instalação com dados reais.

Na primeira inicialização, o sistema procura uma única conta cujo Client ID e Client Secret coincidam com a integração antiga, mesmo quando há vários usuários. Nesse caso, associa os RPS históricos à conta existente e preserva seus tokens e configurações atuais. Se nenhuma conta corresponder e existir apenas um usuário, a integração antiga dos arquivos bling-config.json e tokens.json, as configurações existentes e os RPS antigos são associados a uma conta desse usuário. Os arquivos originais são preservados e não são usados pelas operações das novas contas. O ID de pagamento antigo é preservado somente na conta importada.

Se houver vários usuários e nenhuma conta corresponder às credenciais antigas, o backend não adivinha quem é dono da integração global. Defina LEGACY_BLING_USER_ID no backend/.env com o UUID do proprietário e reinicie. Até essa definição, os RPS antigos ficam preservados e fora das filas das novas contas. A importação é transacional e executada uma única vez.

Credenciais e tokens passam a ser persistidos no PostgreSQL. Novas contas começam sem credenciais nem tokens; configure e autorize cada uma. O callback configurado no aplicativo Bling deve apontar para http://localhost:3000/api/bling/callback (ou a URL pública equivalente).

## Validação

- Backend: npm test -- --runInBand e npm run build, na pasta backend.
- Frontend: node --test test/bling-api.test.mjs e npm run build, na pasta frontend (Node 24).
- Os testes automatizados usam dados simulados e não emitem notas reais.

A aplicação mantém a arquitetura de um processo de backend: operações da mesma conta são serializadas para evitar renovações concorrentes de token. Para executar várias réplicas, substitua essa coordenação por um lock distribuído antes de colocar as réplicas em produção.

## Fila automática de RPS

O backend inicia o processamento automaticamente, sem depender de uma aba aberta. A cada ciclo, consulta até cinco itens em processamento e envia até cinco pendentes por conta conectada e ativa, de usuários ativos. Depois do ciclo, aguarda 15 segundos; a tela se atualiza a cada cinco segundos. O servidor e o PostgreSQL precisam continuar ligados. Configure AUTO_RPS_ENABLED=false no backend/.env e reinicie para desativar; o padrão é true.

O envio manual e o automático compartilham a reserva atômica do RPS no banco. Antes de enviar, consultam a nota no Bling. Uma nota já emitida não é reenviada, mesmo sem número retornado. Os estados seguem a [referência oficial do Bling](https://developer.bling.com.br/referencia).

Erros não são reenviados automaticamente: corrija a causa e use Emitir Selecionados. Se o envio perder a conexão ou receber uma resposta ambígua, o RPS permanece em processamento, e os ciclos seguintes apenas consultam o Bling. Uma reinicialização também retoma essas consultas, sem repetir o envio. Se continuar sem confirmação, confira a nota no Bling antes de intervir; a automação não presume que o envio falhou.
