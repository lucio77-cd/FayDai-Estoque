# Guia passo a passo, Ajuda e pesquisa de opinião

Três recursos para o cliente se virar sozinho e para o desenvolvedor saber o que ele acha do sistema na prática.

## 1. Guia passo a passo (uma vez por versão)

- Abre sozinho **uma única vez por navegador** para cada valor de `GUIA_VERSAO` (`js/uso.js`). O valor é gravado assim que o guia aparece, então não importa como o cliente o feche.
- O botão **Rever o passo a passo** (aba Ajuda) abre de novo quando ele quiser.
- **Para mostrar o guia de novo depois de uma atualização:** atualize os passos em `PASSOS_DO_GUIA` (`js/ui/orientacao.js`) e troque `GUIA_VERSAO` por uma data nova. Não troque em ajustes pequenos, para não cansar o cliente.
- Quando o guia abre, a pergunta de opinião não aparece junto.
- O estado fica no `localStorage` (chave `faydai-guia-versao`). Em outro computador ou navegador o guia abre uma vez de novo.

## 2. Aba Ajuda e dúvidas

Perguntas curtas, em passo a passo, com busca por palavra (sem diferenciar maiúsculas nem acentos). Para incluir uma dúvida, copie um bloco `<details class="faq-item">` em `index.html` (`#faq-lista`). A busca usa o texto do bloco inteiro.

## 3. Mensagem de dias de uso

Aparece no Painel: "Você usa o FayDai há N dias." Conta os dias do calendário desde a criação da conta (`metadata.creationTime` do Firebase Authentication). A partir de 30 dias acrescenta um agradecimento.

## 4. Pesquisa de opinião contínua

Uma pergunta por vez, em um cartão no Painel (não bloqueia nada). Nas perguntas de **nota** o cliente toca em 1 a 5 e pode explicar (opcional); nas de **texto** ele escreve a resposta.

### Como evita cansar (constantes em `js/feedback.js`)

| Regra | Valor |
|---|---|
| Só começa depois de | 3 dias de uso |
| Chance de aparecer, quando liberada | 50% a cada abertura do sistema |
| Depois de **responder** | descansa 7 dias |
| Depois de **ver e ignorar** | só volta depois de 3 dias |
| "Agora não" | adia 3 dias |
| Repetição | não repete uma pergunta já respondida até acabar as 9; depois recomeça (sem repetir a última) |

O estado fica no `localStorage` (chave `faydai-feedback-estado`). Se o envio falhar, o cartão avisa, permite tentar de novo e a resposta **não** conta como respondida.

### Perguntas

Estão em `PERGUNTAS` (`js/feedback.js`). Para incluir uma, acrescente um item com `id` único (nunca reaproveite o `id` de uma pergunta antiga, porque os resultados são agrupados por ele). O texto da pergunta é gravado junto com a resposta, então mudar o texto no futuro não apaga o histórico.

### Onde ficam as respostas

Coleção `feedback` do Firestore, um documento por resposta:

`perguntaId`, `pergunta`, `tipo` (`nota` ou `texto`), `nota` (1 a 5 ou `null`), `comentario`, `usuario` (e-mail), `versaoGuia`, `diasDeUso`, `data`, `dataHora`, `criadoEm`.

Nenhum dado de cliente final é guardado, só o que o lojista respondeu.

### Como ver os resultados

1. **Página `resultados.html`** (ex.: `https://faydaiestoque.vercel.app/resultados.html`). Entre com a conta de **administrador** (a sua). Mostra, por pergunta, quantidade de respostas, média, distribuição de notas e os comentários, mais **Baixar CSV**. A página não aparece em nenhum menu do sistema nem em buscadores (`noindex`).
2. **Firebase Console → Firestore Database → `feedback`**, para ver os documentos crus.

### Regras do Firestore (publicar no Console)

O arquivo completo, com este bloco já encaixado nas regras publicadas, está em `firestore.rules` (com marcadores no lugar dos e-mails). O bloco abaixo é só a parte nova, em versão simplificada. **Não foi testado em um emulador**: use o "Simulador de regras" do Console antes de publicar.

```
match /feedback/{id} {
  // A loja só cria a própria resposta; ninguém altera nem apaga.
  allow create: if request.auth != null
    && request.auth.token.email in ['EMAIL_DA_LOJA']
    && request.resource.data.usuario == request.auth.token.email
    && request.resource.data.keys().hasOnly(['perguntaId','pergunta','tipo','nota','comentario','usuario','versaoGuia','diasDeUso','data','dataHora','criadoEm'])
    && (request.resource.data.nota == null
        || (request.resource.data.nota is int && request.resource.data.nota >= 1 && request.resource.data.nota <= 5))
    && request.resource.data.comentario.size() <= 500;
  // Só o administrador lê.
  allow read: if request.auth != null && request.auth.token.email in ['EMAIL_DO_ADMINISTRADOR'];
  allow update, delete: if false;
}
```

Crie a conta de administrador em **Authentication → Usuários → Adicionar usuário**. Sem essas regras, o envio da resposta é recusado: o cartão mostra "Não foi possível enviar agora" e o resto do sistema continua normal.
