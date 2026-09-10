# `config/` — registry del toolbelt de terceros

Aquí **ya no vive nada de Cortex**. Su MCP, la skill `cortex-capture` y el comando
`/cortex-save` se reparten en el plugin de Claude Code (`plugin/claude-code/`) y los instala
`cortex setup` (ADR-0014 revisado y ADR-0032). Lo que queda es el esquema del registry con el
que una organización reparte **sus** herramientas.

```
config/
  toolbelt.json   # registry vacío: la plantilla del esquema
  README.md       # esto
```

## Para qué sirve

Un registry declara qué MCPs, skills y comandos debe tener un dev, y el CLI los instala de
forma idempotente en cada agente detectado. El de tu organización vive en un repo propio
—normalmente privado— porque no es producto, es la configuración de una empresa concreta
(ADR-0026):

```bash
cortex toolbelt sync https://…/toolbelt.json     # llega en el PR de `cortex toolbelt`
```

El esquema del fichero está en [`docs/toolbelt-registry.md`](../docs/toolbelt-registry.md).

Se reparte **configuración, nunca credenciales**: cada entrada documenta en `auth` qué tiene
que configurar el dev por su cuenta, y una entrada cuyas variables no estén exportadas se
omite con un aviso en vez de romper la instalación.

## Y lo de Cortex, ¿dónde está?

```bash
cortex setup --all        # configura todos los agentes detectados
cortex setup --status     # qué hay instalado y dónde
```

En Claude Code eso instala el plugin `cortex@dinacode-cortex`, que trae los hooks
(contexto al empezar, captura al terminar), el MCP (`cortex mcp`, que habla con el servidor y
respeta tus permisos), la skill de captura y `/cortex-save`. Si el plugin no se puede instalar
—por ejemplo, sin acceso al repo— se cae a hooks en `~/.claude/settings.json` y funciona igual.

**Cortex es opt-in por repo**: los hooks están a nivel de usuario, pero solo actúan donde hay
un `.cortex.json`, que se crea con `cortex link`. Sin vínculo no se inyecta ni se captura nada.

## En este mismo repo

`.claude/skills/cortex-capture` y `.claude/commands/cortex-save.md` son symlinks a
`plugin/claude-code/`, para trabajar en la skill y verla en vivo sin instalar el plugin.
