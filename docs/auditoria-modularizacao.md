# Auditoria `main` × `modularizacao`

Comparação estática (leitura do código, sem rodar o app) entre a `main` (`1c2a270`) e a branch
`modularizacao` (a partir de `fda75ef`, data 08/11/2026).

## Conformidade

| Item comparado | `main` | Branch | Resultado |
|---|---|---|---|
| Eventos ligados (seletor + tipo) | 46 | 46 | Idênticos |
| Seletores `#id` usados | 167 | 167 | Idênticos |
| Coleções do Firestore | 8 | 8 | Idênticas |
| Campos gravados no Firestore | 54 | 62 | Mesmos campos (ver observações) |
| Funções | 146 | 165 | Nenhuma perdida (ver observações) |
| Mensagens ao usuário | 85 | 94 | 9 novas, todas de erro pós-gravação |
| `caixa.css`, `styles.css`, `cupom.js` | | | Sem diferença |
| `index.html` | | | Só o `?v=` do `app.js` e um recuo de espaço no `</html>` |

## Observações

- **`clearSessionState`**: deixou de ser função própria e virou a função passada ao `initSessionUI`
  (em `app.js`). Zera as mesmas listas e variáveis; as variáveis agora ficam em `estadoUi`
  (`js/estado.js`).
- **Campos "só na branch"** (`nome`, `custo`, `percentualGanho`, `precoVenda` e outros): artefato da
  contagem. Na `main` eram gravados em forma abreviada (`custo, percentualGanho, ...`); na branch
  aparecem como `percentualGanho: data.percentualGanho`. Os nomes são os mesmos.
- **19 funções novas**: `init...UI`, serviços de gravação e `setSaleBusy`, resultado da divisão em
  módulos.

## Mudanças de comportamento em relação à `main`

1. Devolução idempotente: `registerReturn` exige `returnId` (gerado ao abrir a operação).
2. Venda, vistoria e devolução avisam quando o erro veio depois de gravar.
3. Entrada e saída têm mensagens semelhantes ("Entrada registrada. Não registre novamente...").
4. Os controles do Caixa ficam bloqueados durante a gravação da venda.
5. O cupom reaparece quando uma venda já gravada é reenviada.
6. O filtro "Mostrar produtos arquivados" atualiza a lista na hora.

## Antes de publicar

- Testar no site real (Firebase): venda, devolução, entrada, saída e vistoria. O `?v=` novo
  (`20261108-1`) força o navegador a baixar os módulos de novo.
- Conferir as regras do Firestore para criar `devolucoes/{id}` com ID gerado no cliente (não há
  `firestore.rules` no repositório).

## Verificações automáticas

- `node tools/verificar-modulos.mjs`: 26 arquivos, sem import quebrado, sem ciclos e sem `?v=`
  divergente.
- Não verificado nesta auditoria: ESLint e o roteiro no navegador (o repositório não tem
  `package.json` nem configuração do ESLint).
