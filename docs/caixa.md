# Abertura e fechamento de caixa

Fica na aba **Caixa**, acima da tela de vendas. O módulo Caixa precisa estar ativo em Configurações.

## Como funciona

- **Caixa fechado:** a tela de venda some e aparece "Abrir caixa". Informe o dinheiro que está na gaveta (troco) e, se quiser, uma observação.
- **Caixa aberto:** mostra quando abriu, quem abriu, o dinheiro da abertura, quantas vendas, o total líquido e o **dinheiro esperado** na gaveta. A tela de venda funciona normalmente.
- **Fechar caixa:** o sistema lê o banco de novo e mostra o resumo (vendas por forma de pagamento, devoluções, dinheiro esperado). Você informa o **dinheiro contado**; o sistema mostra se confere, se falta ou se sobra, e pede confirmação quando há diferença. Depois do fechamento o caixa não muda mais.
- Os fechamentos dos últimos 90 dias aparecem em **Fechamentos de caixa**.

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
