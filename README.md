# FayDai-Estoque

Sistema simples de gestão de estoque, entradas, saídas e preços, pensado inicialmente para uma loja de celulares e acessórios. A primeira versão será priorizada para uso no celular e construída para ser demonstrada e validada com o responsável pela loja.

> **Status:** planejamento funcional concluído para iniciar o primeiro protótipo. As funcionalidades serão implementadas e testadas por etapas; este README descreve o escopo e as regras acordadas, não afirma que elas já estejam implementadas.

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
- Definir e validar a estratégia de armazenamento persistente dos dados antes de implementar, para que eles não se percam ao atualizar ou fechar a página.
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
