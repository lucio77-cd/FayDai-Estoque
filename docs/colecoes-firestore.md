# Coleções do Firestore usadas pelo sistema

Inventário feito a partir do código (`js/` e `app.js`). Serve de base para escrever, conferir e versionar as regras de segurança, que hoje ficam só no **Firebase Console → Firestore Database → Regras**.

Todas as gravações são feitas pelo navegador, por uma única conta autorizada. Toda operação que altera saldo é uma transação (`runTransaction`), com ID do documento gerado no cliente quando a operação precisa ser idempotente.

## Resumo

| Coleção | Criar | Atualizar | Excluir | Leitura na tela |
|---|---|---|---|---|
| `produtos` | sim | sim | só com saldo zero e sem histórico | coleção inteira |
| `entradas` | sim | nunca | nunca | `data >= início da janela` |
| `saidas` | sim | nunca | nunca | `data >= início da janela` |
| `vendas` | sim | só cancelamento e contadores de devolução | nunca | `data >= início da janela` |
| `devolucoes` | sim | nunca | nunca | `data >= início da janela` |
| `vistorias` | sim | contagens e status | nunca | coleção inteira |
| `caixas` | sim | só o fechamento (e o documento de controle) | nunca | `data >= início da janela` + controle |
| `historico_custos` | sim | nunca | nunca | consulta por `produtoId` (ao excluir produto) |
| `procura_perdida` | sim | nunca | nunca | não é lida |

"Janela" = últimos 90 dias (`JANELA_HISTORICO_DIAS` em `js/dados.js`). A exportação CSV lê as coleções inteiras.

## Detalhes por coleção

### `produtos`
- **Produtos:** criados em `saveProductTransaction` (ID gerado no cliente, com `cadastroOperationId` e `cadastroFingerprint`). Editados na mesma função. O saldo (`quantidade`) também é alterado por venda, entrada, saída, vistoria, cancelamento e devolução. Arquivar = `update` com `arquivado: true`.
- **Documentos especiais** (ficam na mesma coleção e não são produtos; IDs em `js/constantes.js`):
  - `catalogo_opcoes_faydai`: marcas e categorias (`arrayUnion`, `merge`).
  - `configuracoes_faydai`: dados da loja e módulos ativos (`merge`).
  - `contador_codigo_interno_faydai`: `ultimoNumero` do código interno `FON000` (`merge`).
- As regras de `produtos` precisam aceitar esses três documentos, que não têm `nome`, `custo` nem `quantidade`.

### `entradas`
- Criada em `saveEntryTransaction` (ID do cliente) e, para o estoque inicial, no cadastro do produto (IDs automáticos, `tipo: "estoque_inicial"`). Nunca alterada.

### `saidas`
- Criada em `saveExitTransaction` (ID do cliente). Nunca alterada.

### `vendas`
- Criada em `finishSaleTransaction` (ID do cliente), já com `devolvidoPorProduto: {}` e `valorDevolvido: 0`.
- Atualizações permitidas pelo código:
  - cancelamento: `status`, `canceladaEm`, `canceladaPor`, `motivoCancelamento`;
  - devolução: `devolvidoPorProduto`, `valorDevolvido`, `ultimaDevolucaoId`, `ultimaDevolucaoEm`, sempre junto com a criação da devolução.
- Leituras extras: um `getDoc` por ID para a venda original de uma devolução recente de venda antiga (para o Painel), e a coleção inteira ao excluir um produto.

### `devolucoes`
- Criada em `registerReturn` com **ID gerado no cliente** (`devolucoes/{id}`). Nunca alterada.
- Também é lida por `where("vendaId", "==", ...)` (vendas antigas sem contador) e inteira ao excluir produto.

### `vistorias`
- Vistoria: criada ao iniciar, atualizada ao salvar (`contagens`), descartar ou concluir (`status`, `itens`, `naoContados`, `ignorados`, totais). Nunca excluída.
- **Documento de controle `controle_vistoria_ativa`** (`inventoryId`, `atualizadoEm`, `atualizadoPor`): impede duas vistorias ao mesmo tempo. É um documento da própria coleção, sem `status`.
- Consulta `where("status", "==", "em_andamento")` ao iniciar.

### `caixas`
- Abertura e fechamento de caixa. Detalhes e regras sugeridas em `docs/caixa.md`.
- Criada em `openCaixa` (ID do cliente, `status: "aberto"`); atualizada **uma vez** em `closeCaixa` (`status: "fechado"`, totais, `valorContado`, `diferenca`). Nunca excluída.
- **Documento de controle `controle_caixa_aberto`** (`caixaId`, `atualizadoEm`, `atualizadoPor`): impede dois caixas abertos ao mesmo tempo. Fica na própria coleção, sem `status` nem `data`.
- `vendas` ganha o campo opcional `caixaId` (só nas vendas de hoje feitas com o caixa aberto). A venda lê `caixas/{caixaId}` dentro da transação e é recusada se o caixa não estiver aberto.

### `historico_custos`
- Criado na edição do produto quando o custo muda. Lido só por `where("produtoId", "==", ...)` com `limit(1)`.

### `procura_perdida`
- Criada por `registerLostDemand` ("Cliente pediu e não tinha"): `descricao`, `data`, `dataHora`, `hora`, `diaSemana`, `usuario`, `criadoEm`. A tela não lê esta coleção.

## O que as regras precisam permitir (checklist)

1. Só a conta autorizada (lista de e-mails) lê e grava.
2. Leitura de `entradas`, `saidas`, `vendas` e `devolucoes` **como consulta** (`list`) com `where("data", ">=", "AAAA-MM-DD")`, além de `get` por ID em `vendas`. O Firestore cria sozinho o índice de campo único para `data`.
3. Criação em `devolucoes/{id}` e `procura_perdida` (qualquer ID).
   Em `caixas`: leitura (`get` e `list` por `data >= ...`), criação da abertura, uma atualização de fechamento e o documento de controle (veja `docs/caixa.md`).
4. Documentos especiais de `produtos` e o documento `vistorias/controle_vistoria_ativa`.
5. As proteções descritas no README: saldo e valores sem negativo, `entradas`/`saidas`/`historico_custos`/`devolucoes` só com criação, venda cancelada imutável, vistoria concluída imutável, `usuario` igual ao e-mail da conta.

## Versionar as regras

O repositório não tem `firestore.rules` de propósito: o arquivo precisa refletir exatamente o que está publicado. Para versionar, copie o texto de **Firestore Database → Regras** para `firestore.rules` na raiz, **trocando os e-mails reais por um marcador** (por exemplo `EMAIL_AUTORIZADO`), e confira os itens do checklist acima.

## Registros sem o campo `data`

A janela de 90 dias filtra por `data`. Um documento antigo sem esse campo não aparece na tela, mas aparece na exportação (que lê tudo). Todos os registros gravados pelo código atual têm `data`.
