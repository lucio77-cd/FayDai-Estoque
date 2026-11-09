# Testes automatizados

Os testes de serviço usam um Firestore em memória (`firebase-mock-runtime.mjs`) para validar regras e resultados sem acessar o projeto real nem alterar dados da loja.

Na raiz do repositório, com Node.js 22:

```bash
node tools/verificar-modulos.mjs
find . -path './.git' -prune -o -name '*.js' -type f -print0 | xargs -0 -n1 node --experimental-default-type=module --check
node --experimental-default-type=module --experimental-loader ./tests/firebase-mock-loader.mjs --test ./tests/services.test.mjs
```

Esses testes não substituem testes de integração com o Firestore Emulator nem testes autenticados no projeto Firebase publicado. A validação de permissões, transações concorrentes reais e comportamento do navegador deve ocorrer separadamente, com uma conta e registros de teste.
