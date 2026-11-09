# Testes automatizados

Os testes de serviço usam um Firestore em memória (`firebase-mock-runtime.mjs`) para validar regras e resultados sem acessar o projeto real nem alterar dados da loja.

O mock é estrito de propósito: `transaction.get` só aceita documento (como no SDK web), leituras vêm antes de escritas, IDs `__nome__` e valores `undefined` são rejeitados. Assim, um código que só funcionaria num mock permissivo falha aqui.

Na raiz do repositório, com Node.js 22:

```bash
node tools/verificar-modulos.mjs
find . -path './.git' -prune -o -name '*.js' -type f -print0 | xargs -0 -n1 node --experimental-default-type=module --check
node --experimental-default-type=module --experimental-loader ./tests/firebase-mock-loader.mjs --test ./tests/services.test.mjs
```

Esses testes não substituem testes de integração com o Firestore Emulator nem testes autenticados no projeto Firebase publicado. A validação de permissões, transações concorrentes reais e comportamento do navegador deve ocorrer separadamente, com uma conta e registros de teste.
