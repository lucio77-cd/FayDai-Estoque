# Abertura e fechamento de caixa

Fica na aba **Caixa**, acima da tela de vendas. O módulo Caixa precisa estar ativo em Configurações.

## Como funciona

- **Caixa fechado:** a tela de venda some e aparece "Abrir caixa". Informe o dinheiro que está na gaveta (troco) e, se quiser, uma observação.
- **Caixa aberto:** mostra quando abriu, quem abriu, o dinheiro da abertura, quantas vendas, o total líquido e o **dinheiro esperado** na gaveta. A tela de venda funciona normalmente.
- **Fechar caixa:** o sistema lê o banco de novo e mostra o resumo (vendas por forma de pagamento, devoluções, dinheiro esperado). Você informa o **dinheiro contado**; o sistema mostra se confere, se falta ou se sobra, e pede confirmação quando há diferença. Depois do fechamento o caixa não muda mais.
- Os fechamentos dos últimos 90 dias aparecem em **Fechamentos de caixa**.

## Notas impressas (80 mm, não fiscais)

- **Ao abrir o caixa** sai a nota de abertura: dinheiro da gaveta, operador, observação e, se houver, o caixa anterior (abertura, contado no fechamento, diferença, vendas líquidas) com a variação % da abertura.
- **Ao fechar o caixa** sai a nota de fechamento: totais, formas de pagamento, conferência do dinheiro (esperado, contado, resultado) e o **comparativo com o dia anterior em %** (total líquido, nº de vendas e ticket médio).
- **Dia anterior** = o último dia antes da abertura que teve vendas, procurado até 7 dias para trás (cobre fim de semana e feriado). A data usada aparece na nota. Sem dia anterior com vendas, a nota avisa que não há o que comparar. Se o dia anterior tem valor zero, a variação sai como "sem base".
- O comparativo fica gravado no documento do caixa (`comparativo`), então a nota de fechamento pode ser **reimpressa** pelo histórico exatamente como saiu.
- Em Configurações há a opção "Imprimir a nota ao abrir e ao fechar o caixa" (por computador). Os botões **Reimprimir abertura** e **Reimprimir fechamento** funcionam sempre.
- Se a impressão falhar, o caixa continua salvo; a tela avisa e basta reimprimir.

## Regras

- Só existe **um caixa aberto por vez** (documento de controle `controle_caixa_aberto`, como na vistoria).
- Venda de **hoje** só é registrada com o caixa aberto e guarda `caixaId`. Venda com data de outro dia (retroativa) não entra em nenhum caixa.
- Se o caixa for fechado em outro aparelho, a venda é recusada dentro da transação e nada muda (estoque inclusive).
- **Dinheiro esperado** = dinheiro da abertura + vendas em dinheiro do caixa − devoluções de vendas pagas em dinheiro.
- Vendas canceladas ficam fora dos totais. Devoluções entram no caixa pelo horário (depois da abertura), mesmo que a venda seja de outro dia; a forma de pagamento vem da venda original.
- Abrir e fechar são idempotentes: o ID da abertura e o do fechamento são gerados no cliente e reaproveitados em reenvios.
- Não fecha com uma compra em andamento no carrinho.
- Se a coleção `caixas` ainda não estiver liberada nas regras, a tela avisa e as **vendas continuam como antes, sem exigir caixa aberto**.

## Limites conhecidos

- Cancelar hoje uma venda em dinheiro de um caixa **já fechado** não reduz o dinheiro esperado do caixa de hoje.
- Não há sangria (retirada de dinheiro) nem suprimento durante o dia; só abertura e fechamento.
- Troco é conferido só no dinheiro; cartão, Pix e transferência aparecem como informação, sem contagem.

## Regras do Firestore sugeridas

Troque `autorizado()` pela função que a lista de e-mails já usa nas suas regras e confira o campo de e-mail.

```
match /caixas/{caixaId} {
  allow get, list: if autorizado();

  // documento de controle
  allow create, update: if autorizado() && caixaId == 'controle_caixa_aberto';

  // abertura
  allow create: if autorizado() && caixaId != 'controle_caixa_aberto'
    && request.resource.data.status == 'aberto'
    && request.resource.data.valorAbertura is number
    && request.resource.data.valorAbertura >= 0
    && request.resource.data.abertoPor == request.auth.token.email;

  // fechamento: só um caixa aberto vira fechado; fechado nunca mais muda
  allow update: if autorizado() && caixaId != 'controle_caixa_aberto'
    && resource.data.status == 'aberto'
    && request.resource.data.status == 'fechado'
    && request.resource.data.valorContado is number
    && request.resource.data.valorContado >= 0
    && request.resource.data.fechadoPor == request.auth.token.email;

  allow delete: if false;
}
```

A venda lê `caixas/{id}` dentro da transação e grava o campo `caixaId`; a regra de criação de `vendas` não pode rejeitar esse campo extra.
