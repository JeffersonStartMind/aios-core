# AIOX Core — Fork com Suporte ao OpenCode CLI

> Este é um fork do [aiox-core original](https://github.com/SynkraAI/aiox-core) com suporte nativo ao **OpenCode CLI**.

---

## O que é diferente neste fork?

| Funcionalidade | Original | Este fork |
|----------------|:--------:|:---------:|
| Claude Code | ✅ | ✅ |
| Gemini CLI | ✅ | ✅ |
| Codex CLI | ✅ | ✅ |
| Cursor | ✅ | ✅ |
| GitHub Copilot | ✅ | ✅ |
| AntiGravity | ✅ | ✅ |
| **OpenCode CLI** | ❌ | ✅ **NOVO** |

### Arquivos adicionados

```
.aiox-core/infrastructure/scripts/ide-sync/
  transformers/opencode.js            ← transformer dos agentes
  opencode-commands.js                ← gerador de custom commands

.aiox-core/infrastructure/scripts/
  validate-opencode-integration.js    ← validação da integração

tests/ide-sync/
  opencode-transformer.test.js        ← 21 testes unitários

docs/pt/platforms/
  opencode.md                         ← guia completo PT-BR

types/babel_template/
  index.d.ts                          ← fix de tipos TypeScript

.opencode/                            ← gerado pelo sync
  agents/*.md                         ← 12 agentes AIOX
  commands/aiox-*.md                  ← 12 custom commands
```

---

## Como usar este fork em vez do original

### Em um projeto existente

```bash
# Remover o original (se instalado)
npm uninstall aiox-core

# Instalar este fork diretamente do GitHub
npm install github:JeffersonStartMind/aios-core

# O sync com OpenCode roda automaticamente no postinstall
# Verifique os arquivos gerados:
ls .opencode/agents/    # 12 agentes
ls .opencode/commands/  # 12 custom commands
```

### Em um projeto novo

```bash
# Criar projeto e instalar
mkdir meu-projeto && cd meu-projeto
npm init -y
npm install github:JeffersonStartMind/aios-core

# O OpenCode já estará configurado ao abrir
opencode
```

---

## Não conflita com o original?

**Não**, desde que você use apenas um por projeto. Ambos têm `"name": "aiox-core"` — este fork é um **substituto direto (drop-in replacement)**. Não instale os dois no mesmo projeto.

| Comando | Resultado |
|---------|-----------|
| `npm install aiox-core` | Instala o **original** (sem OpenCode) |
| `npm install github:JeffersonStartMind/aios-core` | Instala **este fork** (com OpenCode) |

---

## Comandos específicos do OpenCode

```bash
# Sincronizar agentes e custom commands
npm run sync:ide:opencode

# Validar sincronização
npm run validate:opencode-sync

# Validar integração completa
npm run validate:opencode-integration
```

## Usar no OpenCode

```
opencode                    # iniciar
/project:aiox-dev           # ativar agente desenvolvedor
/project:aiox-qa            # ativar agente QA
/project:aiox-architect     # ativar agente arquiteto
```

---

## Compatibilidade

Testado com:
- Node.js 18+ e 20+
- OpenCode CLI (qualquer versão recente)
- Windows, macOS, Linux

---

## Contribuindo de volta ao original

Se quiser contribuir este suporte ao OpenCode para o repositório original:
1. Fork o [original](https://github.com/SynkraAI/aiox-core)
2. Cherry-pick os commits deste fork
3. Abra um Pull Request

---

*Fork mantido por [JeffersonStartMind](https://github.com/JeffersonStartMind)*
