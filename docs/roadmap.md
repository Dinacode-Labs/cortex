# Roadmap — Cortex

Lo que queda por hacer. Las decisiones firmes viven en [`decisions.md`](./decisions.md), lo que
cambió en cada versión en [`CHANGELOG.md`](../CHANGELOG.md), y para qué sirve la UI en
[`design.md`](./design.md).

> Aquí solo va el **qué** técnico. Las prioridades de negocio, los responsables y la
> configuración de cada despliegue son de cada operador y no se documentan aquí (ADR-0031).

## Estado (16 de septiembre de 2026, v0.1.10)

Funcionando y en uso diario por un equipo:

- **Identidad, permisos y jerarquía.** Login por email y código. Cada entrada lleva quién la
  escribió. Proyectos públicos o privados con dueño y miembros, y cliente → proyecto con
  herencia. Visibilidad, dueño, padre y borrado de proyectos vacíos se gestionan en caliente.
- **El bucle automático en cinco agentes** (Claude Code, Codex, OpenCode, Hermes, Pi): reciben
  el contexto al abrir sesión y capturan al cerrarla, con `cortex setup`.
- **Destilación en el servidor**: ningún portátil necesita claves de modelo. Idempotente por
  sesión, incremental si la sesión creció, y si no cabe entera reparte las ventanas a lo largo
  de toda la conversación en vez de quedarse con el principio.
- **Cliente ligero en npm** (`@dinacodelabs/cortex`), con `connect-docs`, `connect-github` y
  `connect-sessions`. MCP por HTTP autenticado con las 8 tools aplicando permisos.
- **Context pack completo**: los once tipos que describen el estado del proyecto, repartidos por
  presupuesto y ponderados, con avisos de contradicción pegados a cada entrada.
- **UI web alrededor del proyecto**: memoria, preguntar, lo que ven los agentes, salud, mapa,
  código y ajustes, con sistema de diseño propio.
- **Producción**: imagen en un registro, Caddy con TLS, healthchecks, copias diarias con
  simulacro de restauración, y `/metrics` en formato Prometheus.
- **Retrieval medido**: `pnpm admin eval`, 40 preguntas con evidencia anotada. recall@5 **0.987**,
  MRR **0.928**. Contextual Retrieval sigue aplazado **por una medida y no por una intuición**:
  las preguntas parafraseadas recuperan 1.000, que es justo donde se vería el fallo.

## Qué queda

### Lo que ya está doliendo

- **Nadie valida.** 608 entradas vigentes, **608 sin revisar**. Estado y confianza son los dos
  campos que existen para que un agente sepa de qué fiarse, y mientras no se usen no distinguen
  nada: el pack no puede priorizar por fiabilidad aunque sabe hacerlo. La mitad de este bucle es
  de personas, no de código; lo que el código podía hacer —que se vea y que se pueda filtrar—
  ya está.
- **`search` y `ask` no heredan del padre.** El context pack sube por la cadena de ancestros y
  la búsqueda no, así que dentro de un proyecto hijo no encuentras lo que está guardado en el
  cliente. Con jerarquías reales montándose ahora mismo, esto se nota ya.
- **Salud enseña y no arregla.** Contradicciones, duplicados y huecos enlazan a sus entradas,
  pero fusionar o resolver sigue siendo editar a mano, teniendo `core` las funciones
  (`planLintActions`, `saveWithReconciliation`).
- **No se puede renombrar un proyecto.** El nombre y el slug se fijan al crear; equivocarse
  obliga a borrar y rehacer, y solo si está vacío.

### Ingesta

- **Extracción en el servidor.** Hoy el CLI lee Markdown y texto plano y los formatos que
  necesitan mammoth/unpdf/xlsx o un modelo se quedan en `cortex-admin` (ADR-0058). El servidor
  ya tiene las dependencias y las claves: subir el fichero y extraer allí hace que el conector
  del CLI lo cubra todo y esta división desaparezca.

### Operación y escala

- **Límite de inferencia compartido entre procesos.** El semáforo es **por proceso** y un
  despliegue corre cuatro que llaman al modelo, así que el techo real es
  `procesos × CORTEX_LLM_CONCURRENCY` y hoy hay que dividir a mano. Un límite de verdad exige
  estado compartido: `shared` no puede depender de la base de datos, así que se inyectaría desde
  los entrypoints, como el clasificador. Antes de construirlo hay que medir si el backoff que ya
  existe absorbe el exceso; hoy no hay datos de 429 porque el uso es de pocas personas.
- **Cola de captura persistente.** Vive en memoria: un reinicio con trabajos encolados los
  pierde. Con el volumen actual no compensa; con varios equipos capturando a la vez, sí.
- **Sesiones del MCP en memoria**, lo que ata el despliegue a un solo nodo.
- **Métricas por petición** (latencia, códigos de respuesta). `/metrics` expone el estado del
  sistema, no el del tráfico. El sitio natural es un middleware que alimente el mismo endpoint.
- **Límite de peticiones por IP, general.** El envío de códigos ya está cubierto por IP además
  de por email, que es el único sitio sin autenticar con efecto —y coste— fuera del servidor.
  Para el resto el sitio natural sigue siendo el borde: Caddy o el CDN.
- **Índice ANN** en pgvector. Hoy son 609 vectores y el escaneo secuencial sobra; el umbral está
  en decenas de miles.

### Interfaz

- **Páginas de entidad.** Las entidades se ven como etiquetas que lanzan una búsqueda; el grafo
  sabe más de lo que la UI enseña.
- **Paginación.** Ninguna lista la tiene: límites fijos y ninguna señal de que haya más.
- **Historial de ediciones.** Corregir una entrada sobrescribe y deja solo `updated_at`. Para un
  sistema cuyo argumento es la trazabilidad, es un hueco que se cerrará cuando alguien lo pida.
- **Modo oscuro.** Ahora es redefinir tokens bajo una media query, no una reescritura.

### Producto

- **Registry de toolbelt por proyecto**, además del de la organización.
- **Config de IA por proyecto** (qué modelos y qué fuentes usa cada uno), en el registry externo.
- **Índice navegable dentro de un proyecto (a estudiar).** Un mapa por área que el agente
  recorra, en vez de depender solo de la búsqueda. El contraargumento sigue sin resolver: un
  índice siempre presente compite por el presupuesto de contexto y se desactualiza en cada
  cambio, y la búsqueda evita las dos cosas. Habría que demostrar que gana en algún régimen
  concreto —proyectos enormes, «saber qué existe» frente a «encontrar lo relevante»—. Si sale a
  favor, se generaría en `maintain` y con trazabilidad: sería inferencia, no hecho.

## Camino a abrir el código

El repositorio **ya es público** y los ADR están en inglés. Lo que queda:

1. **Binario compilado y Homebrew.** Hoy el CLI exige Node ≥ 20; un binario evita ese requisito,
   a cambio de firma, notarización y cuatro objetivos de compilación. Se pospuso a propósito
   hasta tener el producto en manos de alguien (ADR-0025), y ya lo está.
2. **v0.2.0**: retirar el alias `LLM_PROVIDER=nan` y la variable `BREVO_SENDER`. El código los
   acepta con aviso y las plantillas ya no los ofrecen.
