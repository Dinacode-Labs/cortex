# El registry del toolbelt (esquema)

Cortex reparte a los agentes de cada developer dos cosas distintas, y conviene no
confundirlas:

1. **Lo suyo** — el MCP de Cortex, la skill `cortex-capture` y el comando `/cortex-save`.
   Eso lo instala `cortex setup`, en Claude Code a través del plugin `plugin/claude-code/`,
   sin que haya que declarar nada en ningún registry.
2. **El toolbelt de tu organización** — los MCPs y skills de las herramientas que use tu
   equipo (gestor de tickets, chat, repositorio, lo que sea). Eso **no** vive en este repo:
   se declara en un registry propio, normalmente en un repo privado, y se instala con
   `cortex toolbelt sync <ruta-o-url>`.

La separación está en el [ADR-0014](./decisions.md) (revisado), el [ADR-0026](./decisions.md) y el [ADR-0032](./decisions.md).

## Formato

Un único JSON con tres listas. Ejemplo completo:

```jsonc
{
  "$comment": "Toolbelt de <tu organización>. Reparte CONFIGURACIÓN, nunca credenciales.",

  // MCPs que se registran en cada agente detectado.
  "mcpServers": {
    // stdio: se lanza un proceso local.
    "tickets": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["mi-mcp-server", "stdio"],
      "env": ["TICKETS_API_KEY", "TICKETS_BASE_URL"],  // se leen del entorno del dev
      "auth": "token personal en TICKETS_API_KEY",     // texto para `cortex sync --doctor`
      "agents": ["claude", "codex", "opencode", "hermes"]
    },
    // http: servidor remoto (OAuth o cabecera). Codex no soporta este transporte.
    "docs": {
      "transport": "http",
      "url": "https://mcp.ejemplo.com/mcp",
      "auth": "OAuth en el navegador la primera vez",
      "agents": ["claude", "opencode", "hermes"]
    }
  },

  // Skills (solo Claude Code): carpetas con SKILL.md dentro del repo del registry.
  "skills": [
    { "name": "mi-skill", "auth": "ninguna" }
  ],

  // Comandos slash (Claude Code, Codex, OpenCode): ficheros .md del repo del registry.
  "commands": [
    { "name": "mi-comando", "file": "mi-comando.md" }
  ]
}
```

## Reglas que conviene respetar

- **Configuración, nunca credenciales.** El campo `env` nombra variables; no pone valores.
  Una entrada cuyas variables no estén exportadas se omite con un aviso, no falla.
- **`{REPO}`** se sustituye por la ruta del checkout cuando el registry es local. Una
  entrada que lo use no se puede instalar desde una URL remota: se omite con aviso.
- **`agents`** acota a qué agentes va cada entrada. Útil porque no todos soportan lo mismo
  (Codex no admite MCP por HTTP, y las skills hoy solo las consume Claude Code).
- El registry es **idempotente**: `cortex sync` sin `--apply` enseña el plan, y al aplicarlo
  respeta lo que ya esté configurado a mano (no pisa la auth existente).
