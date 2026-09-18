# Cortex

*In English: [`README.md`](./README.md) — es la versión de referencia y la que debe estar al
día cuando las dos discrepen.*

**Memoria de proyecto para equipos de software.** Cortex captura el conocimiento que se
dispersa por un proyecto —decisiones, restricciones, incidencias, convenciones, pull requests,
conversaciones, documentación y código—, lo estructura en una capa híbrida que es a la vez
documental, vectorial, grafo y bi-temporal, y se lo sirve a las personas y a los agentes de IA
que programan.

Los agentes lo reciben por un servidor MCP autenticado y un par de hooks que cierran el bucle:
tu agente **arranca** una sesión sabiendo ya el proyecto y, al terminarla, Cortex **captura** lo
aprendido, firmado con tu correo.

Se despliega un servidor y se instala un CLI desde npm. Ningún portátil necesita base de datos
ni claves de modelo: la destilación corre en el servidor.

Apache-2.0. ¿Has encontrado una vulnerabilidad? Mira [`SECURITY.md`](./SECURITY.md).

> **Sobre este documento.** El repositorio está en inglés, entero, porque es público. Esta
> página existe porque el equipo que mantiene Cortex es español y un resumen en su idioma
> ahorra fricción al empezar. Cubre lo esencial; para el detalle completo —las 8 tools, los
> conectores, el despliegue, la estructura del repo— está el [`README.md`](./README.md).

- Decisiones (ADR): [`docs/decisions.md`](./docs/decisions.md) · Roadmap: [`docs/roadmap.md`](./docs/roadmap.md)
- Cómo contribuir: [`CONTRIBUTING.es.md`](./CONTRIBUTING.es.md)
- **[Cómo funciona Cortex](./docs/how-it-works.md)** (en inglés): una guía de las tripas desde
  cero. Qué es un embedding, qué es RAG, qué aporta un grafo de conocimiento, qué hace cada
  agente de IA. Está escrita para que puedas juzgar si Cortex funciona bien y dónde debería
  mejorar, así que cada concepto viene con sus límites reales.

---

## Pruébalo en tu máquina

Antes de montar nada para tu equipo puedes levantar un Cortex entero en local. Solo hace falta
Docker.

```bash
curl -fsSL https://raw.githubusercontent.com/Dinacode-Labs/cortex/main/deploy/local.yml -o cortex-local.yml
docker compose -f cortex-local.yml up -d
npm install -g @dinacodelabs/cortex
cortex auth login --server http://localhost:8787
```

El código de acceso no se envía a ningún correo: se imprime en el log del servidor.

```bash
docker compose -f cortex-local.yml logs server | grep -oE '[0-9]{6}' | tail -1
```

Y ya está:

```bash
cortex link --create "Mi Proyecto"   # en el repositorio que quieras
cortex setup --all                   # configura tus agentes
cortex doctor                        # comprueba que todo está en su sitio
```

Todo escucha **solo** en `127.0.0.1`, los datos sobreviven a un reinicio y
`docker compose -f cortex-local.yml down -v` lo borra sin dejar rastro.

**Qué funciona sin ninguna clave:** las 8 tools MCP, guardar, buscar, los context packs, el
lint y la UI web en `localhost:8080`.

**Qué necesita un modelo:** la captura automática de sesiones. Destilar una conversación en
piezas de conocimiento es justo el trabajo del LLM, así que sin uno los hooks no producen nada.

```bash
# Ollama, ya corriendo en tu máquina
LLM_PROVIDER=openai-compatible LLM_ALLOW_NO_KEY=1 LLM_MODEL=llama3.1 \
  LLM_BASE_URL=http://host.docker.internal:11434/v1 \
  docker compose -f cortex-local.yml up -d
```

Los embeddings por defecto son locales y **no** semánticos: existen para que esto arranque sin
claves, no para juzgar la calidad de la búsqueda. Para eso, apunta `EMBEDDINGS_*` a un endpoint
real.

Esto **no** es un despliegue de producción: sin TLS, sin copias de seguridad y sin límite de
quién puede darse de alta. Eso está en [`deploy/README.md`](./deploy/README.md).

## Para developers

Un solo comando instala el CLI `cortex` y te da de alta con tu correo y un código:

```bash
curl -fsSL https://<tu-servidor-cortex>/install.sh | sh
```

Después, en cada repositorio:

```bash
cortex link --create "Mi Proyecto"   # o `cortex link` si el proyecto ya existe
cortex setup --all                   # Claude Code, Codex, OpenCode, Pi, Hermes
cortex doctor                        # qué falta y qué comando lo arregla
```

Cortex es **opt-in por repositorio**: los hooks viven a nivel de usuario, pero solo actúan
donde hay un `.cortex.json`, que es lo que crea `cortex link`. Sin vínculo no se inyecta nada
y no se captura nada.

Si trabajas contra **varios servidores** de Cortex a la vez, el servidor es una propiedad del
repositorio y no una variable global: sale del `.cortex.json` de cada carpeta, y las
credenciales guardan una sesión por servidor (ADR-0033).

## Qué hace

- **Guarda y busca conocimiento tipado**: decisiones, restricciones, incidencias,
  convenciones, arquitectura, reglas de negocio, deuda técnica, riesgos y más.
- **Cada unidad conserva su trazabilidad**: fuente, fecha, autor, confianza, estado y
  vigencia. Una inferencia no se convierte en un hecho.
- **Context packs**: lo que tu agente necesita saber del proyecto al abrir sesión, repartido
  por secciones y recortado a un presupuesto de caracteres.
- **Captura automática al cerrar sesión**: el hook manda el transcript condensado y limpio de
  secretos, y el servidor lo destila con su propia clave.
- **Jerarquía de proyectos**: un cliente con varios repos es un proyecto padre con un hijo por
  repo. La herencia sube (un repo ve lo de su cliente) y los permisos también.
- **Lint de la memoria**: contradicciones, duplicados, entradas obsoletas y huecos.
- **UI web** para leer, corregir y validar lo que los agentes han ido guardando.

## Arquitectura, en una línea

Postgres 16 + pgvector como base única (documental + vectorial + relacional); `@cortex/core`
determinista y sin LLM; `@cortex/agents` (Mastra sobre un endpoint OpenAI-compatible) inyectado
desde cada entrypoint; y MCP, API HTTP, UI web y CLI consumiendo `core`.

El detalle está en el [`README.md`](./README.md#architecture) y el porqué de cada pieza en
[`docs/decisions.md`](./docs/decisions.md).

## Licencia y seguridad

Apache-2.0 (ver [`LICENSE`](./LICENSE) y [`NOTICE`](./NOTICE)). Para reportar una
vulnerabilidad, [`SECURITY.md`](./SECURITY.md) — en privado, nunca como issue público.
