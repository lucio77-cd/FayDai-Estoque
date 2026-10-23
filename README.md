# FayDai-Estoque

Sistema simples de gestão de estoque, entradas, saídas e preços, pensado inicialmente para uma loja de celulares e acessórios. A primeira versão será priorizada para uso no celular e construída para ser demonstrada e validada com o responsável pela loja.

> **Status:** protótipo em desenvolvimento. Já inclui login, painel inicial (dashboard com estoque baixo, rankings e gráfico), produtos (com histórico de alteração de custo e estoque mínimo), entradas, Caixa (vendas com preço ajustável e alertas, cancelamentos e devoluções), Saídas, vistoria física, exportação para CSV e configurações. A vistoria e os cancelamentos/devoluções foram validados em teste real; o dashboard novo e a exportação CSV ainda precisam ser validados no navegador.

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
- Informar, opcionalmente, o **estoque mínimo** de cada produto.

Não haverá rastreamento individual de celulares por IMEI ou número de série.

**Estoque mínimo:** campo opcional e inteiro, definido manualmente pelo usuário. Vazio significa "sem aviso" para aquele produto. Quando o saldo fica igual ou abaixo do mínimo, o cartão do produto mostra "baixo" e o Painel lista o produto em "Estoque baixo". Uma previsão automática de duração do estoque, baseada nas saídas, fica para depois de algumas semanas de vendas reais.

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

**Regra definida (produtos não contados):**
- Produto com o campo de contagem **vazio** é considerado **não contado**: não é alterado e **mantém o saldo atual**.
- Informar **0** significa que o produto foi contado e não há nenhuma unidade: o saldo é ajustado para 0.
- Ao concluir, o sistema mostra quantos produtos foram contados, quantos terão o saldo ajustado e quantos **não foram contados**, e pede confirmação.
- A vistoria concluída registra também a lista dos produtos não contados (com o saldo mantido).
- Isso permite contar apenas parte dos produtos por vez (por exemplo, uma prateleira).

**Implementação atual:**
- Existe no máximo uma vistoria em andamento por vez. O andamento pode ser salvo e retomado; descartar uma vistoria em andamento a apaga sem alterar nenhum saldo.
- Ao concluir, a diferença é calculada com o saldo do momento da conclusão (não o de quando a contagem começou), dentro de uma transação.
- Cada produto contado registra: saldo anterior, quantidade contada, diferença, data e responsável. Os saldos só são alterados nos produtos com diferença.
- A vistoria concluída não pode ser editada nem apagada. O histórico mostra as 10 últimas vistorias; as demais permanecem salvas.
- Produtos arquivados ou excluídos durante a contagem são ignorados e ficam registrados como tal.
- Limite de 400 produtos com diferença por conclusão (limite de escritas de uma transação do Firestore); acima disso, deixe alguns produtos em branco e conclua em partes.
- Os ajustes ficam registrados na própria vistoria (coleção `vistorias`) e não aparecem nos históricos de Entradas e Saídas.

### 6. Cancelamentos e devoluções
- **Cancelamento:** manter o registro original, marcar a venda como cancelada e devolver automaticamente as quantidades ao estoque.
- **Devolução:** adicionar automaticamente ao estoque a quantidade devolvida e manter o registro da venda e da devolução.
- Vincular a devolução a uma venda existente e impedir que a quantidade devolvida ultrapasse a quantidade vendida ainda não devolvida.
- Não apagar o histórico para corrigir uma movimentação.

**Implementação atual:**
- Cada venda do histórico do Caixa tem os botões **Devolver itens** e **Cancelar venda**.
- **Cancelar venda** vale só para a venda inteira e só se ela não teve nenhuma devolução. Exige motivo, devolve todas as unidades ao estoque e marca a venda com `status: "cancelada"`, `canceladaEm`, `canceladaPor` e `motivoCancelamento`. Itens, total, custo e data da venda nunca mudam. Uma venda cancelada não pode mais ser alterada.
- **Devolver itens** é parcial, por item: o usuário informa as quantidades (até o que foi vendido menos o que já foi devolvido) e o motivo. A devolução é gravada na coleção `devolucoes` (somente criação), com o preço cobrado e o custo gravados na venda original.
- Quanto já foi devolvido de uma venda é calculado somando as devoluções dela; não existe contador gravado na venda.
- Não há limite de dias para cancelar ou devolver.
- O sistema registra apenas o valor devolvido; não controla a forma de reembolso.
- Produtos arquivados ou excluídos bloqueiam a devolução ao estoque, com aviso claro.
- Cancelamentos e devoluções não aparecem nos históricos de Entradas e Saídas: o registro do movimento é a própria venda (cancelamento) ou a devolução.
- Vendas antigas, de um formato anterior sem identificação dos produtos, não podem ser canceladas nem devolvidas pelo sistema.
- O limite "não devolver mais do que foi vendido" é garantido pelo aplicativo (as regras do Firestore não somam documentos).

### 7. Painel inicial (dashboard)
O painel deverá apresentar, conforme existirem dados suficientes:
- quantidade de produtos cadastrados;
- valor estimado do estoque, usando o custo cadastrado vigente;
- produtos abaixo do estoque mínimo;
- total de vendas registradas;
- diferença bruta estimada das vendas;
- atalhos para cadastrar produtos e registrar movimentações.

Os indicadores devem ser calculados a partir dos registros reais do sistema. Não devem ser exibidos dados de exemplo como se fossem dados reais.

**Implementação atual:** o Painel é a primeira aba do sistema.
- **Estoque** (sempre o do momento): produtos cadastrados, unidades, produtos sem estoque e valor estimado pelo custo.
- **Estoque baixo:** produtos ativos com mínimo definido e saldo igual ou abaixo dele (os 8 mais urgentes; os demais aparecem em Produtos).
- **Vendas do período** (hoje, últimos 7 dias, este mês ou todo o período; padrão: este mês): faturamento líquido, diferença bruta estimada, ticket médio (faturamento líquido ÷ número de vendas) e unidades vendidas (vendidas menos devolvidas).
- **Mais vendidos no período:** top 5 produtos por unidades líquidas.
- **Formas de pagamento no período:** faturamento líquido por forma de pagamento; a devolução é descontada da forma usada na venda original.
- **Vendas por dia:** gráfico de barras dos últimos 7 ou 30 dias (independente do período escolhido); toque em uma barra para ver o valor do dia. Dias em que as devoluções superam as vendas aparecem sem barra.
- A diferença bruta usa o custo gravado em cada item no momento da venda; vendas antigas, feitas antes desse registro existir, ficam fora desse cálculo e o painel informa quantas foram. Produtos arquivados e saídas manuais não entram nos cálculos. O lucro líquido não é apresentado, pois as despesas ainda não são registradas.
- **Cancelamentos e devoluções no Painel:** vendas canceladas ficam fora de todos os cálculos do período (e o painel informa quantas foram). Devoluções são descontadas no período em que foram registradas, usando o preço e o custo gravados na venda original.

### 8. Exportação para CSV
Em **Configurações → Exportar dados (CSV)** há um botão para cada arquivo e um botão **Exportar tudo** (cópia de segurança).

- **Produtos:** todos os produtos (ativos e arquivados), com custo, preços, saldo, estoque mínimo e valor em estoque.
- **Vendas:** uma linha por item vendido, com status (ativa ou cancelada), preço, custo da época, forma de pagamento, quantidade devolvida e dados do cancelamento. O total da venda se repete em cada linha do item: não some essa coluna.
- **Devoluções:** uma linha por item devolvido, ligada à venda.
- **Entradas** e **Saídas:** todo o histórico.
- O filtro de período (hoje, últimos 7 dias, este mês, todo o período) vale só para Vendas e Devoluções; o padrão é "Todo o período".
- Formato: separador ponto e vírgula, vírgula decimal, datas dd/mm/aaaa e acentos corretos no Excel brasileiro.
- Os códigos de barras só com dígitos saem protegidos (`="..."`) para o Excel não transformá-los em notação científica. Textos que começam com `=`, `+`, `-` ou `@` recebem um apóstrofo na frente, para impedir que a planilha os trate como fórmula.
- Antes de gerar, o sistema recarrega os dados do banco. Não há nova gravação nem mudança nas regras do Firestore.
- "Exportar tudo" baixa até 5 arquivos seguidos; o navegador pode pedir permissão para múltiplos downloads. Arquivos sem registros não são baixados e o sistema avisa quais foram.
- As vistorias ainda não são exportadas.

## Regras gerais de negócio

1. Todas as quantidades serão controladas numericamente, sem identificação individual de cada unidade.
2. Toda entrada, saída ou ajuste deve gerar um registro de movimentação.
3. Uma venda não pode deixar o estoque negativo.
4. Entradas alteram a quantidade, mas não atualizam automaticamente o custo cadastrado.
5. O custo do cadastro é alterado manualmente e seu histórico de alteração deve ser preservado.
6. O preço praticado pode diferir do sugerido; o sistema informa os alertas acordados.
7. A vistoria concluída aplica os ajustes automaticamente aos produtos contados e registra as diferenças; produtos não contados mantêm o saldo.
8. Cancelamentos e devoluções mantêm seus próprios registros, sem apagar a movimentação original.
9. Valores financeiros devem ser identificados claramente para não confundir faturamento, ganho bruto estimado e lucro líquido.

## Prioridade de implementação

A primeira demonstração foi construída por etapas:

1. **Cadastro de produtos**, incluindo custo, percentual de ganho, preço sugerido e quantidade inicial.
2. **Registro de entradas**, com atualização do saldo e histórico da compra.
3. **Registro de saídas e vendas**, incluindo validação do estoque disponível.
4. **Dashboard básico**, com indicadores derivados dos registros.
5. **Vistoria física**, com contagem por lista e ajustes rastreáveis.
6. **Cancelamentos e devoluções.**
7. **Dashboard ampliado, estoque mínimo e exportação CSV** (pacote atual, a validar).

Próximos passos previstos: página de administração (licença por data, aviso de vencimento, acompanhamento de acessos e erros) e preparação da conta do cliente. A previsão de duração do estoque fica para depois de algumas semanas de vendas reais.

## Decisões pendentes

- Validar as regras do Firestore, a autenticação e a persistência no navegador.
- Validar o dashboard ampliado e a exportação CSV com dados de teste.
- Confirmar com o responsável pela loja as necessidades adicionais após experimentar o protótipo (por exemplo, forma de reembolso e prazo para cancelar).

## Critérios para validar a demonstração

- Cadastrar um produto e calcular corretamente seu preço sugerido.
- Registrar uma entrada e conferir o novo saldo.
- Registrar uma venda e conferir a redução do saldo.
- Tentar vender mais unidades do que há disponíveis e confirmar o bloqueio.
- Atualizar a página e verificar que os dados continuam salvos.
- Conferir se os indicadores do dashboard correspondem aos registros existentes.
- Realizar uma vistoria de teste e verificar se os ajustes e o histórico estão corretos.
- Cancelar uma venda de teste e devolver itens de outra, conferindo estoque e Painel.
- Exportar os CSV e conferir se os números batem com o sistema.

## Princípio do projeto

O FayDai-Estoque começa como uma ferramenta simples para resolver necessidades reais da loja. A demonstração será usada para conversar com o responsável, observar o fluxo de trabalho e decidir quais melhorias são realmente necessárias.

As funcionalidades e regras deste documento poderão evoluir com base nessa validação, mantendo o histórico dos dados e evitando complexidade antes da hora.


## Protótipo atual

Arquivos:
- `index.html`: telas de login, painel, produtos, entradas, Caixa, saídas, vistoria, configurações (com exportação), ajuda, tutorial e painel de cancelamento/devolução.
- `styles.css`: layout responsivo com prioridade para celular.
- `app.js`: autenticação Firebase, painel, produtos, entradas, vendas, cancelamentos e devoluções, saídas, vistoria, exportação CSV e leitura/gravação no Cloud Firestore.

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
9. Em Saídas, teste uma retirada manual com motivo, por exemplo, perda ou uso interno. Confira a baixa e o histórico.
9. Desative e reative os módulos para confirmar que o histórico permanece.

### Teste do Painel

1. Abra a aba Painel e confira se a quantidade de produtos, as unidades e o valor do estoque batem com o catálogo (soma de saldo × custo cadastrado).
2. Faça uma venda no Caixa e volte ao Painel: o faturamento e a quantidade de vendas devem aumentar.
3. Troque o período (hoje, 7 dias, este mês, todo o período) e confira se os valores mudam de acordo com as datas das vendas.
4. Confira se o aviso de vendas sem custo registrado aparece apenas quando existirem vendas antigas no período.
5. Teste os atalhos do Painel.

### Teste da Vistoria

1. Abra a aba Vistoria e toque em **Iniciar vistoria**.
2. Digite a contagem de dois ou três produtos, deixando os demais em branco. Confira a diferença exibida em cada linha e o resumo (contados, não contados, com diferença).
3. Toque em **Salvar andamento**, recarregue a página e confira se as contagens continuam lá.
4. Digite `0` em um produto com saldo e confira que ele aparece como contado, com diferença negativa.
5. Toque em **Concluir vistoria**. A confirmação deve informar quantos foram contados, quantos terão o saldo ajustado e quantos não foram contados.
6. Confirme e verifique em Produtos que só os produtos com diferença tiveram o saldo alterado e que os não contados mantiveram o saldo.
7. Abra o histórico de vistorias, toque em **Ver detalhes** e confira os ajustes (saldo anterior → contado) e a lista de não contados.
8. Inicie outra vistoria e use **Descartar vistoria**: nenhum saldo deve mudar.

### Teste de Cancelamentos e Devoluções

Use poucos produtos de teste.

1. Faça duas vendas de teste no Caixa (A e B), cada uma com 2 itens. Anote o saldo de cada produto e o faturamento do Painel.
2. Na venda A, toque em **Devolver itens**. Devolva 1 unidade de um item, com motivo. Confira: saldo do produto +1, etiqueta "Devolução parcial" e a devolução listada na venda.
3. Ainda na venda A, tente devolver mais do que o disponível: o sistema deve bloquear. Confirme que o botão **Cancelar venda** não aparece mais (a venda já teve devolução).
4. No Painel, confira que o faturamento caiu pelo valor devolvido e que a linha de vendas mostra "devoluções".
5. Na venda B, toque em **Cancelar venda**, informe o motivo e confirme. Confira: todos os itens voltaram ao estoque, a venda ficou com etiqueta "Cancelada" e os botões sumiram.
6. No Painel, confira que a venda B saiu do faturamento e que o aviso mostra "1 cancelada (fora do cálculo)".
7. Devolva o restante da venda A até esgotar: a etiqueta deve virar "Totalmente devolvida".
8. Em Produtos, tente excluir um produto que teve devolução com saldo zero: ele deve ser arquivado, não apagado.

### Teste do Painel ampliado, do estoque mínimo e da exportação CSV

**Estoque mínimo**
1. Em Produtos, edite um produto com saldo 5 e defina **Estoque mínimo = 5**. Salve.
2. O cartão do produto deve mostrar "5 un. · baixo" e "Estoque mínimo 5 un.". No Painel, em "Estoque baixo", o produto deve aparecer.
3. Registre uma entrada de 10 unidades desse produto: ele deve sair da lista de estoque baixo.
4. Edite o produto e apague o estoque mínimo (campo vazio): nenhum aviso deve aparecer para ele.

**Painel**
5. Com vendas de teste no mês, confira: ticket médio (faturamento ÷ número de vendas), unidades vendidas, top 5 mais vendidos e formas de pagamento (os valores somados devem bater com o faturamento).
6. Faça uma devolução e confira que as unidades, o faturamento e o pagamento correspondente diminuem.
7. Em "Vendas por dia", alterne entre 7 e 30 dias e toque em uma barra para ver o valor do dia.

**Exportação**
8. Em Configurações → Exportar dados, escolha "Todo o período" e toque em **Produtos**. Abra o arquivo no Excel: acentos corretos, valores com vírgula, código de barras sem notação científica.
9. Exporte **Vendas**: confira que há uma linha por item, que a venda cancelada aparece com o status "Cancelada" e que a quantidade devolvida aparece no item.
10. Exporte **Devoluções**, **Entradas** e **Saídas** e confira se os totais batem com o sistema.
11. Toque em **Exportar tudo**: o navegador pode pedir permissão para múltiplos downloads; aceite e confira os 5 arquivos.
12. Troque o período para "Hoje" e exporte **Vendas**: só as vendas de hoje devem aparecer.

**Atenção:** o registro de vendas usa a coleção `vendas`, as devoluções usam `devolucoes` e a vistoria usa `vistorias` no Cloud Firestore. Se o Firebase negar leitura ou gravação, será necessário conferir as regras publicadas do Firestore para permitir o acesso autorizado a essas coleções. O código no GitHub não altera as regras diretamente no console do Firebase.


## Regras do Firestore

As regras de segurança são publicadas no **Firebase Console → Firestore Database → Regras** e não ficam neste repositório. Elas devem:
- aceitar apenas contas cujo e-mail esteja em uma lista de e-mails autorizados;
- impedir saldo negativo e valores de custo ou preço negativos;
- permitir somente criação (nunca edição ou exclusão) em `entradas`, `saidas`, `historico_custos` e `devolucoes`;
- em `vendas`, permitir a criação e uma única atualização controlada: marcar a venda como cancelada, alterando apenas `status`, `canceladaEm`, `canceladaPor` e `motivoCancelamento` (com `canceladaPor` igual ao e-mail da conta); venda cancelada nunca mais muda e nenhuma venda pode ser excluída;
- exigir que o campo `usuario` das vendas, saídas e devoluções seja o e-mail da conta autenticada;
- permitir excluir produto apenas com saldo zero;
- em `vistorias`, permitir salvar, concluir ou descartar apenas vistorias em andamento; uma vistoria concluída nunca mais pode ser alterada ou apagada.

O campo `estoqueMinimo` dos produtos não exige nenhuma regra nova.

Não publique o e-mail real da conta autorizada neste repositório.
