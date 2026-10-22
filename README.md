# FayDai-Estoque

Sistema simples de gestão de estoque, entradas, saídas e preços, pensado inicialmente para uma loja de celulares e acessórios. A primeira versão será priorizada para uso no celular e construída para ser demonstrada e validada com o responsável pela loja.

> **Status:** protótipo em desenvolvimento. Já inclui login, painel inicial (dashboard), produtos (com histórico de alteração de custo), entradas, Caixa (vendas com preço ajustável e alertas), Saídas e configurações. Ainda precisam ser validados no navegador com o projeto Firebase.

## Objetivo

Ajudar a loja a acompanhar de forma simples:
- produtos e quantidades disponíveis;
- entradas e saídas de estoque;
- vendas e preços praticados;
- custos cadastrados, percentual de ganho e preço sugerido;
- indicadores básicos para acompanhar a operação.

O sistema começará com uma loja e um único usuário. Novas necessidades serão avaliadas após a demonstração e o uso inicial.

## Escopo da primeira versão

### 1. Cadastro de produtos
- Cadastrar e consultar produtos pelo nome e pela descrição.
- Informar o custo de aquisição cadastrado.
- Informar o percentual de ganho desejado.
- Calcular o preço sugerido a partir do custo e do percentual.
- Manter o estoque controlado exclusivamente por quantidade.
- Permitir edição dos dados do produto.

Não haverá rastreamento individual de celulares por IMEI ou número de série.

### 2. Entradas de estoque
Cada entrada deverá registrar:
- produto;
- quantidade recebida;
- custo unitário informado naquela compra;
- data;
- fornecedor, quando conhecido;
- responsável pelo registro, quando aplicável;
- observação opcional.

A entrada aumenta a quantidade disponível. O custo unitário informado na entrada será guardado no histórico, mas **não atualizará automaticamente o custo cadastrado do produto**.

### 3. Saídas e vendas
- Registrar manualmente as saídas.
- Para uma venda, registrar produto, quantidade e preço praticado.
- Bloquear a venda quando a quantidade solicitada superar o saldo disponível.
- Registrar as movimentações para permitir consultar como o saldo foi alterado.
- Permitir preço de venda diferente do preço sugerido, exibindo alertas quando o preço praticado estiver abaixo do sugerido ou do custo cadastrado. Esses alertas, por si só, não bloqueiam a venda.

### 4. Custos e precificação
O custo cadastrado será atualizado manualmente por usuário autorizado. As entradas não alteram esse custo automaticamente.

O preço sugerido seguirá a regra de percentual sobre o custo (markup):

**Preço sugerido = custo cadastrado × (1 + percentual de ganho / 100)**

Exemplo: custo de R$ 1.000,00 e percentual de ganho de 20% resultam em preço sugerido de R$ 1.200,00.

O sistema deverá distinguir:
- **faturamento:** valores das vendas registradas;
- **diferença bruta estimada:** preço praticado menos o custo cadastrado aplicável;
- **lucro líquido:** não será apresentado como apurado sem registro das despesas necessárias.

O custo cadastrado é uma referência atualizada manualmente; não deve ser confundido com custo médio calculado automaticamente a partir das compras.

Cada alteração do custo cadastrado gera um registro imutável na coleção `historico_custos` (custo anterior, novo custo, data e usuário). O cartão do produto mostra o último custo anterior e a data da alteração.

### 5. Vistoria física
- Apresentar uma lista de produtos para preencher as quantidades contadas.
- Permitir salvar uma vistoria em andamento e retomá-la.
- Ao concluir a vistoria, ajustar automaticamente o saldo dos produtos efetivamente contados.
- Registrar o saldo anterior, a quantidade contada, a diferença, a data e o responsável.
- Preservar o histórico dos ajustes.

**Regra ainda pendente:** definir o tratamento dos produtos que não forem contados na vistoria. Até essa decisão ser tomada, o comportamento não deve ser considerado fechado.

### 6. Cancelamentos e devoluções
- **Cancelamento:** manter o registro original, marcar a venda como cancelada e devolver automaticamente as quantidades ao estoque.
- **Devolução:** adicionar automaticamente ao estoque a quantidade devolvida e manter o registro da venda e da devolução.
- Vincular a devolução a uma venda existente e impedir que a quantidade devolvida ultrapasse a quantidade vendida ainda não devolvida.
- Não apagar o histórico para corrigir uma movimentação.

### 7. Painel inicial (dashboard)
O painel deverá apresentar, conforme existirem dados suficientes:
- quantidade de produtos cadastrados;
- valor estimado do estoque, usando o custo cadastrado vigente;
- total de vendas registradas;
- diferença bruta estimada das vendas;
- atalhos para cadastrar produtos e registrar movimentações.

Os indicadores devem ser calculados a partir dos registros reais do sistema. Não devem ser exibidos dados de exemplo como se fossem dados reais.

**Implementação atual:** o Painel é a primeira aba do sistema. O estoque (produtos cadastrados, unidades, produtos sem estoque e valor estimado) é sempre o do momento. O faturamento e a diferença bruta estimada seguem o período escolhido (hoje, últimos 7 dias, este mês ou todo o período; padrão: este mês). A diferença bruta usa o custo gravado em cada item no momento da venda; vendas antigas, feitas antes desse registro existir, ficam fora desse cálculo e o painel informa quantas foram. Produtos arquivados e saídas manuais não entram nos cálculos. O lucro líquido não é apresentado, pois as despesas ainda não são registradas.

## Regras gerais de negócio

1. Todas as quantidades serão controladas numericamente, sem identificação individual de cada unidade.
2. Toda entrada, saída ou ajuste deve gerar um registro de movimentação.
3. Uma venda não pode deixar o estoque negativo.
4. Entradas alteram a quantidade, mas não atualizam automaticamente o custo cadastrado.
5. O custo do cadastro é alterado manualmente e seu histórico de alteração deve ser preservado.
6. O preço praticado pode diferir do sugerido; o sistema informa os alertas acordados.
7. A vistoria concluída aplica os ajustes automaticamente aos produtos contados e registra as diferenças.
8. Cancelamentos e devoluções mantêm seus próprios registros, sem apagar a movimentação original.
9. Valores financeiros devem ser identificados claramente para não confundir faturamento, ganho bruto estimado e lucro líquido.

## Prioridade de implementação

A primeira demonstração será construída por etapas:

1. **Cadastro de produtos**, incluindo custo, percentual de ganho, preço sugerido e quantidade inicial.
2. **Registro de entradas**, com atualização do saldo e histórico da compra.
3. **Registro de saídas e vendas**, incluindo validação do estoque disponível.
4. **Dashboard básico**, com indicadores derivados dos registros.
5. **Vistoria física**, com contagem por lista e ajustes rastreáveis.
6. **Cancelamentos, devoluções e refinamentos**, conforme o fluxo básico for testado.

A prioridade imediata é permitir cadastrar produtos e registrar entradas. O restante será desenvolvido de forma incremental, sem ampliar o escopo antes de testar o fluxo principal.

## Decisões pendentes

- Definir o comportamento para produtos não contados durante uma vistoria.
- Validar as regras do Firestore, a autenticação e a persistência no navegador.
- Confirmar com o responsável pela loja as necessidades adicionais após experimentar o protótipo.

## Critérios para validar a demonstração

- Cadastrar um produto e calcular corretamente seu preço sugerido.
- Registrar uma entrada e conferir o novo saldo.
- Registrar uma venda e conferir a redução do saldo.
- Tentar vender mais unidades do que há disponíveis e confirmar o bloqueio.
- Atualizar a página e verificar que os dados continuam salvos.
- Conferir se os indicadores do dashboard correspondem aos registros existentes.
- Realizar uma vistoria de teste e verificar se os ajustes e o histórico estão corretos.

## Princípio do projeto

O FayDai-Estoque começa como uma ferramenta simples para resolver necessidades reais da loja. A demonstração será usada para conversar com o responsável, observar o fluxo de trabalho e decidir quais melhorias são realmente necessárias.

As funcionalidades e regras deste documento poderão evoluir com base nessa validação, mantendo o histórico dos dados e evitando complexidade antes da hora.


## Protótipo atual

Arquivos:
- `index.html`: telas de login, painel, produtos, entradas, Caixa, saídas, configurações, ajuda e tutorial.
- `styles.css`: layout responsivo com prioridade para celular.
- `app.js`: autenticação Firebase, painel, produtos, entradas, vendas, saídas e leitura/gravação no Cloud Firestore.

### Configuração necessária no Firebase

1. Em **Authentication → Sign-in method**, habilite o provedor **E-mail/senha**.
2. Confirme que a conta de uso existe no Firebase Authentication. As regras atuais não exigem e-mail verificado; a proteção é a lista de e-mails autorizados.
3. Confirme que o Firestore está criado e que as regras publicadas autorizam somente a conta autorizada (veja a seção “Regras do Firestore”).
4. Para publicar em um host como Vercel, adicione o domínio do site em **Authentication → Settings → Authorized domains**.

### Como validar a primeira versão

1. Abra o site publicado e entre com a conta de teste.
2. Cadastre um produto com custo, percentual de ganho e quantidade inicial.
3. Confira o preço sugerido e o saldo no catálogo.
4. Registre uma entrada adicional e confira se o saldo aumenta.
5. Atualize a página e confirme que o produto e o histórico continuam disponíveis.
6. Teste o tutorial: fechar ou escolher “Entendi, começar” só o fecha naquela sessão; “Não mostrar novamente” impede a abertura automática neste navegador. A opção de Ajuda permite abri-lo novamente.

**Importante:** este protótipo ainda não implementa cancelamentos, devoluções ou vistoria.


## Módulos Caixa e Saídas

- **Caixa:** módulo opcional para registrar vendas. O preço de cada item começa no preço de venda cadastrado e pode ser ajustado no carrinho (preço cobrado). O sistema baixa automaticamente a quantidade do estoque.
- **Alertas de preço:** o Caixa avisa quando o preço cobrado está abaixo do preço sugerido ou abaixo do custo cadastrado. Os alertas não bloqueiam a venda; se algum item estiver abaixo do custo, o sistema pede uma confirmação antes de finalizar. Preço vazio ou zero é tratado como erro e impede a finalização.
- **Dados guardados em cada venda:** para cada item, o preço cobrado, o preço cadastrado, o preço sugerido e o custo cadastrado no momento da venda, além de indicadores de preço alterado, abaixo do sugerido e abaixo do custo. Isso mantém o cálculo histórico correto mesmo que o custo mude depois.
- **Saídas:** registra retiradas manuais que não são vendas: perdas, devoluções ao fornecedor, uso interno e outras saídas.
- Os dois módulos usam o mesmo cadastro e saldo dos produtos, mas mantêm históricos separados.
- Em **Configurações**, Caixa e Saídas podem ser ativados ou desativados separadamente. As abas continuam visíveis; um módulo desativado exibe um aviso e não permite novos registros.
- Desativar um módulo não apaga o histórico já registrado.
- O sistema bloqueia vendas e saídas com quantidade maior que o saldo disponível.

### Teste inicial dos módulos

1. Entre no sistema e abra **Configurações**.
2. Deixe **Caixa** desativado e salve. Abra a aba Caixa e confira se aparece o aviso.
3. Ative **Caixa** e salve.
4. Abra Caixa, pesquise produtos, ajuste as quantidades no carrinho, escolha a forma de pagamento e a data. Finalize a venda.
5. Confira se a quantidade diminuiu em Produtos e se a venda aparece no histórico do Caixa.
6. Tente vender mais unidades do que o saldo disponível; o sistema deve bloquear a operação.
7. No carrinho, altere o preço cobrado para um valor abaixo do sugerido e confira o alerta amarelo. Altere para abaixo do custo e confira o alerta vermelho e a confirmação ao finalizar.
8. Em Saídas, teste uma retirada manual com motivo, por exemplo, perda ou uso interno. Confira a baixa e o histórico.
9. Desative e reative os módulos para confirmar que o histórico permanece.

### Teste do Painel

1. Abra a aba Painel e confira se a quantidade de produtos, as unidades e o valor do estoque batem com o catálogo (soma de saldo × custo cadastrado).
2. Faça uma venda no Caixa e volte ao Painel: o faturamento e a quantidade de vendas devem aumentar.
3. Troque o período (hoje, 7 dias, este mês, todo o período) e confira se os valores mudam de acordo com as datas das vendas.
4. Confira se o aviso de vendas sem custo registrado aparece apenas quando existirem vendas antigas no período.
5. Teste os atalhos do Painel.

**Atenção:** o registro de vendas usa a coleção `vendas` no Cloud Firestore. Se o Firebase negar leitura ou gravação, será necessário conferir as regras publicadas do Firestore para permitir o acesso autorizado a essa coleção. O código no GitHub não altera as regras diretamente no console do Firebase.


## Regras do Firestore

As regras de segurança são publicadas no **Firebase Console → Firestore Database → Regras** e não ficam neste repositório. Elas devem:
- aceitar apenas contas cujo e-mail esteja em uma lista de e-mails autorizados;
- impedir saldo negativo e valores de custo ou preço negativos;
- permitir somente criação (nunca edição ou exclusão) em `entradas`, `saidas`, `vendas` e `historico_custos`;
- exigir que o campo `usuario` das vendas e saídas seja o e-mail da conta autenticada;
- permitir excluir produto apenas com saldo zero.

Não publique o e-mail real da conta autorizada neste repositório. Ao implementar o cancelamento de vendas, a regra da coleção `vendas` precisará permitir a atualização controlada desse registro.
