# Guia AIOX para OpenCode CLI

> 🌐 **PT** | [EN](../../platforms/opencode.md)

---

> **CLI de IA Open-Source com Suporte a 75+ Modelos** — Provider-Agnostic

---

## Visão Geral

### O que é o OpenCode?

O [OpenCode CLI](https://opencode.ai) é um agente de codificação IA para o terminal, open-source e provider-agnostic. Ele oferece uma TUI (Terminal User Interface) moderna construída com Bubble Tea, suporte a 75+ modelos de IA (Claude, GPT, Gemini, Llama e modelos locais offline), e integração com LSP para inteligência de código rica.

### Por que usar AIOX com OpenCode?

| Recurso | Descrição |
|---------|-----------|
| **AGENTS.md nativo** | OpenCode carrega `AGENTS.md` do projeto automaticamente — compatível com AIOX |
| **Custom commands** | `.opencode/commands/*.md` mapeia exatamente para ativação de agentes AIOX |
| **75+ modelos** | Use Claude, GPT-4o, Gemini, DeepSeek, Llama local — sem lock-in |
| **Privacy-first** | Nenhum dado de código é armazenado externamente |
| **Auto-compact** | Gerenciamento inteligente de contexto para sessões longas |
| **Multi-sessão** | Múltiplas sessões concorrentes (dev, qa, architect em paralelo) |

---

## Compatibilidade de Hooks (Realidade AIOX)

| Capacidade | OpenCode | Claude Code (referência) |
|------------|:--------:|:------------------------:|
| Session tracking automático | ✅ Nativo | ✅ Nativo |
| Pre/Post-action hooks | ❌ Não disponível | ✅ Completo |
| Guardrails automáticos | ❌ Manual | ✅ Completo |
| Boundary system (deny rules) | ❌ Não disponível | ✅ Determinístico |
| Custom commands | ✅ `.opencode/commands/` | ✅ Slash commands |
| AGENTS.md | ✅ Nativo | — (usa CLAUDE.md) |

**Compensação:** O AIOX compensa a falta de hooks com instruções completas de agentes em `AGENTS.md` e custom commands por agente.

---

## Requisitos

- [Node.js](https://nodejs.org) v18+ (para o AIOX)
- [OpenCode CLI](https://opencode.ai) instalado
- Chave de API do provider de AI de sua escolha

---

## Instalação

### Passo 1: Instalar o OpenCode CLI

```bash
# Via npm (global)
npm install -g opencode-ai

# Ou via script oficial
curl -fsSL https://opencode.ai/install | sh
```

### Passo 2: Instalar o AIOX no projeto

```bash
cd seu-projeto
npx aiox-core install
# Selecione "OpenCode" quando solicitado (ou deixe sincronizar depois)
```

### Passo 3: Sincronizar agentes e commands

```bash
# Sincronizar todos os agentes e custom commands para .opencode/
npm run sync:ide:opencode

# Validar que tudo está correto
npm run validate:opencode-integration
```

### Verificar instalação

```bash
ls -la .opencode/agents/    # 12 arquivos .md de agentes
ls -la .opencode/commands/  # 12 arquivos aiox-*.md de custom commands
```

---

## Configuração

### Estrutura gerada pelo AIOX

```
projeto/
├── AGENTS.md                       # Instruções do projeto (compatível com OpenCode)
├── .opencode/
│   ├── agents/                     # Definições de agentes AIOX
│   │   ├── dev.md                  # Agente desenvolvedor
│   │   ├── qa.md                   # Agente QA
│   │   ├── architect.md            # Agente arquiteto
│   │   └── ...                     # 12 agentes no total
│   └── commands/                   # Custom commands de ativação
│       ├── aiox-dev.md             # /project:aiox-dev
│       ├── aiox-qa.md              # /project:aiox-qa
│       ├── aiox-architect.md       # /project:aiox-architect
│       └── ...                     # 12 commands no total
```

### Configuração de modelo (opencode.json)

Crie `.opencode/config.json` para definir o modelo padrão:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "autoshare": false,
  "keybinds": {}
}
```

Para usar modelos locais (sem API key):
```json
{
  "model": "ollama/llama3.2"
}
```

---

## Uso Básico

### Iniciando o OpenCode

```bash
# Iniciar no projeto atual
opencode

# O OpenCode carregará automaticamente AGENTS.md das instruções do projeto
```

### Ativando Agentes AIOX

**Via custom commands (recomendado):**
```
/project:aiox-dev
```
Isso ativa o agente **Dex** (desenvolvedor) com instruções completas.

Agentes disponíveis:
| Command | Agente | Persona |
|---------|--------|---------|
| `/project:aiox-dev` | Developer | Dex |
| `/project:aiox-qa` | QA Engineer | Quinn |
| `/project:aiox-architect` | Architect | Aria |
| `/project:aiox-pm` | Product Manager | Morgan |
| `/project:aiox-po` | Product Owner | Pax |
| `/project:aiox-sm` | Scrum Master | River |
| `/project:aiox-analyst` | Analyst | Alex |
| `/project:aiox-data-engineer` | Data Engineer | Dara |
| `/project:aiox-ux-design-expert` | UX Expert | Uma |
| `/project:aiox-devops` | DevOps | Gage |
| `/project:aiox-squad-creator` | Squad Creator | — |
| `/project:aiox-aiox-master` | AIOX Master | — |

### Comandos dos Agentes

Após ativar um agente, use o prefixo `*` para comandos:

```
*help           # Listar todos os comandos disponíveis
*develop        # Implementar story (modos: yolo, interactive, preflight)
*run-tests      # Executar lint e testes
*exit           # Sair do modo agente
```

---

## Multi-Sessão (Feature Exclusiva)

O OpenCode permite múltiplas sessões concorrentes — particularmente útil com AIOX:

```bash
# Terminal 1: Agente de desenvolvimento
opencode
# /project:aiox-dev
# *develop story-42

# Terminal 2: Agente de QA (em paralelo)
opencode
# /project:aiox-qa
# *review-build story-42
```

---

## Sincronização de Agentes

### Como funciona

O AIOX mantém uma única fonte de verdade em `.aiox-core/development/agents/` e sincroniza para todas as IDEs:

```
.aiox-core/development/agents/  (fonte da verdade)
           │
           ├── .opencode/agents/*.md          (agent definitions)
           └── .opencode/commands/aiox-*.md   (custom commands)
```

### Comandos de sincronização

```bash
# Sincronizar OpenCode
npm run sync:ide:opencode

# Validar sync (sem alterações)
npm run validate:opencode-sync

# Validar integração completa
npm run validate:opencode-integration
```

---

## Limitações Conhecidas

| Limitação | Severidade | Compensação |
|-----------|-----------|-------------|
| Sem lifecycle hooks | Alta | Instruções completas em `AGENTS.md` + rules detalhadas |
| Sem guardrails automáticos | Alta | Executar validators manualmente: `npm run validate:parity` |
| Sem boundary protection | Média | Instruções enfatizam não modificar arquivos L1/L2 |
| Sem session tracking automático | Baixa | Auto-compact nativo do OpenCode gerencia contexto |

---

## Troubleshooting

### Custom command não aparece

```bash
# Ressincronizar agents e commands
npm run sync:ide:opencode

# Verificar arquivos gerados
ls .opencode/commands/aiox-*.md
```

### AGENTS.md não reconhecido

Certifique-se de que o `AGENTS.md` está na raiz do projeto (não em subdiretório).
O OpenCode carrega `AGENTS.md` do diretório onde foi iniciado.

---

## Recursos Adicionais

- [Documentação OpenCode](https://opencode.ai/docs)
- [Repositório OpenCode](https://github.com/sst/opencode)
- [Guia de Integração AIOX](../ide-integration.md)

---

*Synkra AIOX - Guia da Plataforma OpenCode CLI v1.0*
