<p align="center">
  <img src="assets/images/logo.svg" width="96" alt="QuizzV" />
</p>

<h1 align="center">QuizzV</h1>

<p align="center">Quizzes de estudo gerados por IA, para jogar sozinho ou com a turma.</p>

---

## Funcionalidades

- **Gerador com IA**: cria quizzes de V ou F ou múltipla escolha a partir de um tema, PDF, DOCX ou fotos (Gemini, DeepSeek via GitHub Models ou Ollama). O modelo do Gemini (Flash, Flash-Lite, Pro…) é escolhido nas configurações, com a lista de modelos liberados para a sua chave.
- **Assuntos e reforço com IA**: cada questão tem um assunto; no resultado o app mostra onde você mais errou e gera um quiz de reforço focado nesses assuntos, sem repetir as questões erradas.
- **Modo solo**: progresso salvo automaticamente, retomada de onde parou, modo embaralhado, revisão só das questões erradas e histórico de melhor resultado.
- **Multiplayer em tempo real**: o anfitrião cria uma sala, os amigos entram com um código e o ranking é atualizado a cada pergunta (Supabase Realtime). Mostra quem está online, quantos já responderam e fecha a pergunta quando todos respondem; o anfitrião pode remover jogadores.
- **Pastas** para organizar os simulados por matéria, com cor própria.
- **Arquivos `.qv` criptografados**: compartilhe pelo WhatsApp; o arquivo só pode ser aberto pelo QuizzV.
- **Conversor JSON → `.qv`** e importação direta de `.json`.
- **Backup e restauração** de toda a biblioteca num único arquivo `.qv`.
- **Exportação em PDF**: caderno de questões em duas colunas com gabarito comentado.
- **Busca na biblioteca**, tema claro/escuro e seis cores de destaque (com contraste acessível).
- **Animações fluidas**: confete com física (gravidade, resistência do ar e papel girando) ao mandar bem e no pódio final, alternativas que "pulam" quando certas e tremem quando erradas, vibração nas respostas, transição entre questões e botão "Criar com IA" que recolhe ao rolar. Tudo respeita a opção "reduzir movimento" do sistema.
- **Atualização automática** do APK pelo próprio app.

## O formato `.qv`

Desde a versão 1.5 o `.qv` é um arquivo binário criptografado com **XChaCha20-Poly1305** (cifra autenticada):

```
"QZV2" (4 bytes) | nonce (24 bytes) | quiz em JSON cifrado + tag de autenticação
```

- Quem abrir o arquivo num editor de texto vê só bytes aleatórios; qualquer alteração invalida o arquivo.
- No Android, o QuizzV se registra para o tipo `application/vnd.quizzv`, para `application/octet-stream` (como o WhatsApp entrega arquivos desconhecidos) e para a extensão `.qv`. Tocar no arquivo numa conversa abre o app e importa o quiz.
- Arquivos `.qv` antigos (base64 + XOR) e `.json` continuam sendo importados.

> A chave fica dentro do APK. Isso impede que qualquer pessoa leia ou edite os quizzes, mas alguém disposto a fazer engenharia reversa do app consegue extraí-la: é a mesma limitação de qualquer proteção feita só no aparelho.

### Chave de criptografia

A chave **não** fica no repositório. Gere uma vez e guarde em local seguro: se ela mudar, os `.qv` antigos deixam de abrir.

```bash
node -e "console.log('EXPO_PUBLIC_QV_KEY=' + require('crypto').randomBytes(32).toString('hex'))" > .env.local
```

Para os builds do EAS, cadastre a mesma chave como variável de ambiente:

```bash
eas env:create --name EXPO_PUBLIC_QV_KEY --value <chave> --environment preview --environment production --visibility sensitive
```

### Conversor no computador

`conversor.py` faz a mesma conversão fora do app (lê a chave do `.env.local`):

```bash
pip install pynacl
python conversor.py meu_quiz.json   # gera meu_quiz.qv
python conversor.py meu_quiz.qv     # gera meu_quiz_recuperado.json
```

O JSON aceito pode ser `{ "title", "type", "questions": [...] }` ou só a lista de questões:

```json
{
  "title": "Estruturas de dados",
  "type": "mc",
  "questions": [
    {
      "question": "Qual estrutura segue o princípio LIFO?",
      "options": ["A) Fila", "B) Pilha", "C) Lista", "D) Árvore"],
      "answer": "B",
      "explanation": "Na pilha, o último a entrar é o primeiro a sair."
    }
  ]
}
```

Para V ou F, use `"type": "vf"` e `"answer": "Verdadeiro"` ou `"Falso"`.

## Servidor do multiplayer (Supabase)

O banco (tabelas, permissões, tempo real e funções) está em `supabase/schema.sql`. Para montar um projeto novo, cole o arquivo no SQL Editor do Supabase e rode; ele pode ser executado de novo sem apagar nada. Depois, atualize a URL e a chave pública em `src/services/supabase.js`.

As telas da partida não dependem só dos eventos em tempo real: cada uma também confere o estado da sala ao conectar, periodicamente e ao voltar para o app (`src/services/roomSync.js`), então ninguém fica preso se um evento se perder.

## Rodando o projeto

```bash
npm install
npx expo start
```

Gerar o APK de teste:

```bash
eas build -p android --profile preview
```

Depois de mudar `app.json` (ícones, intent filters), regenere a pasta nativa antes de um build local:

```bash
npx expo prebuild -p android --clean
```

Teste do formato `.qv`:

```bash
node scripts/qvCodec.test.mjs
```

## Tecnologias

React Native 0.81 · Expo SDK 54 · React Navigation 7 · Supabase · Google Gemini · `@noble/ciphers`

---

Desenvolvido por **Victor Kauan** · Ciência da Computação, UFPI · [GitHub](https://github.com/victor-kauan-coder) · [LinkedIn](https://www.linkedin.com/in/victor-miranda-5342a6337)
