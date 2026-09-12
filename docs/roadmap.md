# Roadmap — Cortex

Lo que queda por hacer en el producto. Las decisiones técnicas firmes viven en
[`decisions.md`](./decisions.md), y lo que cambia en cada versión, en
[`CHANGELOG.md`](../CHANGELOG.md).

> Aquí solo va el **qué** técnico. Las prioridades de negocio, los responsables y la
> configuración concreta de cada despliegue son de cada operador y no se documentan en este
> repo (ADR-0031).

## Estado (septiembre 2026, v0.1.0)

Hecho y en el producto:

- **Identidad, atribución y permisos.** Login por email y código, sin contraseñas. Cada
  entrada lleva el email de quien la escribió. Proyectos públicos o privados, con dueño y
  miembros, y jerarquía cliente → proyecto.
- **El bucle automático en cinco agentes.** Claude Code, Codex, OpenCode, Hermes y Pi
  reciben el contexto del proyecto al abrir sesión y lo capturan al cerrarla. Se instala con
  `cortex setup`, en Claude Code y Codex a través de un plugin (ADR-0032).
- **Destilación en el servidor** (ADR-0025). El hook condensa y limpia en local; el servidor
  destila con su clave. Ningún portátil necesita credenciales de modelo. Idempotente por
  sesión, y si la sesión creció solo se destila la parte nueva.
- **Cliente ligero en npm**: `@dinacodelabs/cortex`, un bundle de ~110 KB, 24 MB instalado.
  Antes había que clonar el monorepo entero.
- **MCP por HTTP autenticado**, con las 8 tools aplicando los permisos de quien llama, y
  `cortex mcp` como puente stdio para los agentes.
- **Ingesta multimodal v1**: documentos, imágenes, audio y vídeo, con chunking estructural.
- **Proveedores enchufables** (`openai-compatible`), routing por rol y semáforo de
  concurrencia compartido.
- **Producción**: imagen compilada en un registro, Caddy con TLS, healthchecks reales,
  copias de seguridad diarias y restauración con simulacro (ADR-0027).
- **Gobernanza**: Apache-2.0, política de seguridad, plantillas y Dependabot.

## Qué queda

### El retrieval ya se mide — HECHO (2026-09-12)

`pnpm admin eval` corre 40 preguntas en español con la evidencia anotada contra un corpus fijo
(`tests/fixtures/eval/`), y da recall@5 y MRR por tipo de pregunta. El corpus va en el repo y
no sale de la memoria real a propósito: un eval sirve para comparar ejecuciones, y la memoria
real cambia todos los días.

**Línea base:** recall@5 **0.961**, MRR **0.901** con `qwen3-embedding`. Lo parafraseado se
recupera entero; se cae en las preguntas repartidas entre varias entradas.

**Qué desbloquea, y cómo queda:** Contextual Retrieval estaba aplazado hasta que el eval
mostrara fallos por pérdida de contexto. **No los muestra**: el recall de las preguntas
parafraseadas es 1.000, que es justo donde se vería. Sigue aplazado, y ahora por una medida y
no por una intuición. La investigación está en
[`research/chunking-strategies.md`](./research/chunking-strategies.md).

### Deducir el tipo de entrada de la pregunta — HECHO (2026-09-12)

Lo primero que sacó el eval, y arreglado midiendo. La búsqueda deduce la categoría cuando la
pregunta la nombra («deuda técnica», «restricciones», «riesgos») y empuja ese tipo hacia
arriba, **sin filtrar**: filtrar perdería la respuesta cuando está guardada con otro tipo.

recall@5 0.961 → **0.987**, MRR 0.901 → **0.928**, y las preguntas repartidas 0.850 → 0.950,
sin mover el resto. El tamaño del empujón se eligió por la curva del eval, no a ojo.

### Índice navegable dentro de un proyecto (a estudiar)

En un proyecto con mucha información, un mapa por área con resúmenes que el agente pueda
recorrer, en vez de depender solo de la búsqueda.

**El contraargumento, que hay que resolver antes de escribir código:** un índice siempre
presente compite por el presupuesto de contexto y se desactualiza en cada cambio; la búsqueda
evita las dos cosas. Habría que demostrar que gana en algún régimen concreto —proyectos
enormes, navegación estructural, «saber qué existe» frente a «encontrar lo relevante»—. Si
sale a favor, se generaría en `maintain`, nunca a mano, y con trazabilidad: sería inferencia,
no hecho.

### Operación y escala

- **Límite de peticiones por IP.** Hoy solo hay límite por email en el envío de códigos. El
  sitio natural es un plugin de Caddy o el CDN.
- **Cola de captura persistente.** Ahora vive en memoria: si el servidor se reinicia con
  trabajos encolados, se pierden. Con el volumen actual no compensa; con varios equipos
  capturando a la vez, sí.
- **Sesiones del MCP en memoria**, lo que ata el despliegue a un solo nodo.
- **Observabilidad HTTP**: hoy se mide el uso de modelo y embeddings, no las peticiones.
- **Índice ANN** en pgvector. A partir de unas decenas de miles de vectores, el escaneo
  secuencial deja de ser suficiente.

### Producto

- **Registry de toolbelt por proyecto**, además del de la organización.
- **Config de IA por proyecto** (qué modelos y qué fuentes usa cada proyecto), en el registry
  externo.

## Camino a abrir el código

1. **Instantánea limpia.** El repositorio no se abre publicando este historial: se abre desde
   un commit inicial en un repositorio nuevo (ADR-0026). El procedimiento va en
   `CONTRIBUTING.md`.
2. **Los ADRs, el roadmap y la investigación siguen en español.** Son el registro de
   trabajo del equipo. Decidir si se traducen es una decisión aparte: traducirlos congela lo
   que está pensado para seguir vivo.
3. **Binario compilado y Homebrew.** Hoy el CLI exige Node ≥ 20; un binario evita ese
   requisito, a cambio de firma, notarización y cuatro objetivos de compilación. Se pospuso a
   propósito hasta tener el producto en manos de alguien (ADR-0025).
4. **v0.2.0**: retirar el alias `LLM_PROVIDER=nan` y la variable `BREVO_SENDER`.
