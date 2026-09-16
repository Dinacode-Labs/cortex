# Changelog

Cambios notables de Cortex. Formato: [Keep a Changelog](https://keepachangelog.com/es/1.1.0/);
versionado [SemVer](https://semver.org/lang/es/).

Mientras estemos en `0.x`, una versión **menor** puede traer cambios incompatibles y una
**patch** solo arregla cosas.

## [Unreleased]

### Fixed
- **El informe de salud estaba medio lleno de ruido, y el ruido venía del grafo.** `entities.type`
  admitía `decision` e `incident`, que son tipos de **entrada**, así que la misma decisión se
  guardaba dos veces: una como entrada y otra como nodo del grafo con la frase entera por
  nombre. En una instalación real, **222 nodos así**, y las 18 contradicciones detectadas eran
  todas entre nodos y ninguna entre entradas, con pares tan poco útiles como «opción C ⟷ opción
  A». Una entidad vuelve a ser **una cosa que se nombra**: los dos tipos salen del enum, los
  nombres se filtran por forma (nada de frases ni de deícticos) y una migración limpia los que
  había. No se toca ninguna entrada. Ver ADR-0055.

### Fixed
- **Una sesión larga perdía siempre su final, y nadie se enteraba.** El destilado trocea la
  sesión en ventanas y se queda con ocho; al llegar al tope cortaba, así que de una sesión de
  128.000 caracteres se destilaban los primeros 72.000 y se tiraba el resto — y en una sesión
  de trabajo las conclusiones están al final. La captura además terminaba en `done` con sus
  contadores, idéntica a una que sí había cabido. Ahora, cuando no cabe entera, las ventanas se
  reparten a lo largo de toda la sesión (primera y última siempre incluidas) y la captura
  guarda cuántos caracteres se han quedado fuera.

### Fixed
- **La mitad de la memoria no llegaba nunca a un agente.** El context pack renderizaba cinco de
  los catorce tipos de entrada, porque eran cinco campos escritos a mano en una interfaz. Medido
  sobre un proyecto real de 349 entradas: **172 de 348 vigentes (51 %)** eran de tipos que el
  pack no pintaba —entre ellas 38 incidencias, mientras el informe de salud del mismo proyecto
  avisaba de «incidencias sin decisión»—. Ahora entra todo lo que describe el **estado** del
  proyecto: arquitectura, reglas de negocio, incidencias, integraciones, notas de módulo y
  how-to, además de los cinco de antes. Quedan fuera a propósito los tres que son registro de un
  suceso (reunión, PR, ticket), y hay un test que obliga a que eso siga siendo una decisión.
  Ver ADR-0054.
- **Cada entrada del pack gastaba un 23 % en repetir su propio título.** El resumen se saca de
  los primeros caracteres del contenido, que empieza por el título, así que **355 de 355**
  resúmenes de ese proyecto empezaban repitiéndolo. Se quita al guardar.

### Changed
- El presupuesto del contexto de sesión pasa de 6.000 a **8.000 caracteres**: estaba dimensionado
  para un pack que cubría un tercio de la memoria. Con el pack completo, 8.000 es el punto en que
  las once secciones llevan contenido — 25 entradas en vez de 13.
- Las secciones del pack van **ponderadas**: lo que gobierna el trabajo de hoy (decisiones,
  restricciones, arquitectura) pesa el doble que lo que lo acompaña.

## [0.1.6] — 2026-09-15

### Fixed
- **Un rediseño desplegado podía no llegar nunca al navegador.** `/styles.css` se servía sin
  `Cache-Control` ni `ETag` —solo `Last-Modified`—, así que el navegador se quedaba la copia
  anterior sin preguntar: quien ya había entrado veía el HTML nuevo con los estilos viejos, a
  medio pintar, que es indistinguible de un despliegue roto. La hoja lleva ahora la versión
  pegada a la URL.

### Changed
- **Repaso visual completo.** Una escala coherente (un acento, cinco tonos de tinta, espaciado
  en múltiplos de cuatro, seis tamaños de texto) y una capa de componentes de verdad en
  `views/components.ts` que las pantallas **componen** en vez de escribir HTML suelto — antes
  la misma idea salía distinta en cada sitio. Sin framework de CSS: lo que faltaba era una
  escala, no una herramienta. Ver ADR-0053.
- Sello de marca propio en lugar de la palabra con la primera letra en azul.

## [0.1.5] — 2026-09-15

### Changed
- **La UI web gira ahora alrededor del proyecto.** Eran ocho enlaces planos y cada pantalla
  tenía su propio selector, así que pasar de una sección a otra te devolvía al primer proyecto
  de la lista. Ahora la portada son tus proyectos y cada uno tiene su dirección —`/p/<slug>`—
  con sus secciones colgando: Memory, Ask, **What agents see**, **Health**, Map, Code y
  Settings. Las etiquetas están escritas para quien las lee, no para el interior del sistema.
  Todas las direcciones antiguas redirigen. Ver ADR-0050.
- **Lo que ven los agentes y el informe de salud ahora enlazan.** El pack de contexto y cada
  contradicción, hueco o duplicado llevan a las entradas implicadas: enseñar un problema sin
  forma de abrirlo enseña a ignorar los avisos.
- **Las entradas se pueden corregir**, no solo validar o rechazar. Como casi todo lo escribe un
  agente, poder decir «esto está mal» sin poder arreglarlo dejaba la memoria sin forma de
  mejorar.
- **El coste de IA pasa a `/admin/usage` y solo lo ven los admins.** Lo que gasta la instalación
  en inferencia no es asunto de cada developer que entra a revisar una decisión.
- La UI está **en inglés** también en lo que se generaba sobre la marcha, y el nombre del
  producto sale de `CORTEX_BRAND_NAME` también en los botones, no solo en la cabecera.
- La interfaz **funciona en un móvil**.

### Fixed
- El checkbox del mapa de conocimiento no se podía desmarcar desde la interfaz.

### Added
- **Un proyecto ya se puede gestionar después de crearlo.** Hasta ahora la visibilidad se
  fijaba al crearlo y no había forma de cambiarla en ninguna interfaz —ni UI, ni API, ni CLI,
  ni siquiera una función de dominio—, así que un proyecto nacido público lo era para siempre.
  Ahora su **dueño** (no solo un admin global) puede volverlo privado o público, traspasar la
  propiedad y gestionar los miembros, desde `PATCH /projects/:slug` y
  `POST`/`DELETE /projects/:slug/members`. Ver ADR-0051.
- **Todo proyecto tiene slug.** Una migración rellena los que faltaban, y los proyectos que
  crea un `save` pasan por el mismo camino que `cortex link --create`: con slug y con dueño.
  Antes nacían sin slug y sin dueño, imposibles de vincular, de adoptar y de cerrar.

### Fixed
- **La portada de la UI salía vacía teniendo cientos de entradas visibles.** Se pedían las 60
  entradas más recientes de todos los proyectos y se descartaban después, en memoria, las de
  proyectos sin acceso: bastaba con que esas 60 fueran ajenas —o no tuvieran proyecto— para
  que la primera pantalla del producto apareciera en blanco. Medido sobre datos reales: 452
  entradas accesibles, 0 mostradas. El filtro de acceso pasa a ir dentro de la consulta, antes
  de ordenar y limitar. Ver ADR-0052.

## [0.1.4] — 2026-09-15

### Fixed
- **Al agente solo le llegaban las decisiones del proyecto.** El pack de contexto que se
  inyecta al abrir sesión se recortaba con un corte al final, así que en un proyecto grande
  —medido en uno real: 28.389 caracteres— el tope de 6.000 se lo comía todo menos parte de la
  primera sección. Las restricciones, los riesgos, la deuda técnica y las convenciones **no
  llegaban nunca**, y nada lo decía: una sección ausente se lee como «aquí no hay nada de eso».
  Ahora el recorte lo hace el servidor repartiendo el hueco entre secciones, cada una dice
  cuántas entradas se ha dejado, y el orden dentro de cada sección va por confianza y no por
  fecha de creación (que tras un backfill no ordena nada). Ver ADR-0049.

## [0.1.3] — 2026-09-15

### Fixed
- **`cortex ui` abría el navegador en `localhost`.** Se autenticaba correctamente contra tu
  servidor, pedía el ticket de un solo uso, decía «Opening the Cortex UI, already signed in»…
  y abría una dirección que no existe. Es de los fallos más desconcertantes que hay, porque
  todo el flujo parece ir bien. La causa: la dirección de la web salía de una variable con un
  default de desarrollo, y no de lo que el propio servidor publica en `/client-config` —que
  está justo para esto. Ahora manda el servidor; `CORTEX_WEB_URL` sigue pudiendo forzarla y
  `localhost` queda como último recurso.

## [0.1.2] — 2026-09-15

### Fixed
- **`cortex auth login` se iba al servidor equivocado.** Con una sesión ya configurada,
  ejecutarlo sin `--server` intentaba autenticar contra el servidor de desarrollo por defecto
  en vez de contra el tuyo — el único comando del CLI que no respetaba lo que ya había. Ahora
  los comandos que no trabajan dentro de un repositorio (`auth login`, `auth logout`, `ui`)
  siguen una sola regla: lo que pides a mano manda, luego el entorno, luego la única sesión
  que haya, y **con varias se pregunta** en vez de adivinar. Sin nadie delante —un script— no
  adivina tampoco: dice cuáles hay y para. Los comandos que sí trabajan en un repositorio
  siguen sacándolo del `.cortex.json` y no preguntan nunca (ADR-0033).
- **Dos conectores escribían en el servidor equivocado.** `connect-sessions` y
  `connect-github` no resolvían el servidor desde la carpeta, así que con varios Cortex
  configurados mandaban el conocimiento al de por defecto. Es exactamente lo que ADR-0033
  existe para impedir.

### Changed
- **`cortex connect-sessions` ya no pide lo que la carpeta ya sabe.** Ejecutado dentro de un
  repositorio vinculado no necesita ni slug ni ruta: los saca del `.cortex.json` y del
  directorio. Pedir ambos era redundante e invitaba a escribir el slug de otro proyecto. La
  forma explícita sigue valiendo para backfillear una carpeta distinta.

### Added
- **`GET /metrics` en formato Prometheus** (ADR-0048), para enterarse de lo que un chequeo de
  salud no ve: que el worker de mantenimiento muera —no tiene puerto, y es quien mantiene la
  memoria viva— o que las capturas empiecen a fallar mientras el servicio sigue respondiendo
  tan campante. Formato estándar y no panel propio: esto lo despliega otra gente, que ya tiene
  su forma de vigilar, y un panel hay que mirarlo. Apagado salvo que se defina
  `CORTEX_METRICS_TOKEN`; sin token responde 404 y no 403, para no anunciar lo que hay.
- El worker late también en la base de datos, no solo a un fichero dentro de su contenedor,
  que era el motivo de que su muerte fuera invisible desde fuera.

## [0.1.1] — 2026-09-14

### Fixed
- **Las sesiones largas se perdían enteras.** El servidor rechaza con 413 lo que pase de
  150.000 caracteres, y una sesión de trabajo con un agente los pasa de sobra — medido,
  154.035 en una sola. Justo las sesiones largas son las que más conocimiento llevan, así que
  el efecto era perder el día entero de trabajo. Ahora el cliente recorta antes de enviar, y
  lo hace **por el principio**: una sesión termina en conclusiones y empieza en tanteos, así
  que si hay que perder algo, que sea el tanteo. Queda una marca para que la destilación no
  lea el corte como el comienzo de la conversación.
- **`cortex doctor` daba una falsa alarma con varios servidores.** Cualquiera de ellos caído
  producía «1 problem stopping Cortex from working» aunque el que usa esa carpeta estuviera
  perfectamente. Ahora solo bloquea el servidor que la carpeta usa de verdad —el del
  `.cortex.json`, o el de por defecto—; el resto es un aviso, con el comando exacto para
  cerrar esa sesión si ya no hace falta. La primera vez que alguien ve una alarma que no es
  verdad, deja de fiarse del diagnóstico entero.

### Changed
- **El registro de decisiones, revisado de arriba abajo y en inglés.** Tenía doce decisiones
  **sin número**, escondidas dentro de otra con cabeceras sueltas: dos de ellas ya se citaban
  por el título porque no había número al que apuntar. Ahora son ADR-0036 a ADR-0047, con su
  fecha real sacada del historial. Diecisiete seguían marcadas «aceptada (demo)» en un sistema
  desplegado y en uso. El orden se rompía a partir del 0024. Y el índice nuevo cuenta el hilo
  por fases —fundación, multiusuario, limpieza de arquitectura, límites asumidos, producto,
  uso real—, que es lo que hacía falta para ver a dónde iba esto y por qué. Los números no
  cambian: los citan 67 ficheros.

### Added
- **Límite por IP en el envío de códigos de acceso.** Ya había límite por dirección de correo,
  que impide machacar a una persona; lo que no impedía es pedir códigos para muchas direcciones
  distintas desde una sola IP, porque cada una estrenaba su propio cupo. Con el envío de correo
  activo eso son mensajes de verdad a gente de verdad, y una factura. Ajustable con
  `CORTEX_AUTH_IP_MAX` y `CORTEX_AUTH_IP_WINDOW_MIN`.

### Fixed
- **El instalador dice por qué ha fallado, en vez de culpar siempre a los permisos.** Silenciaba
  la salida de `npm` y, pasara lo que pasara, mandaba a reconfigurar el prefijo de npm. Si el
  paquete no existía, si el registro no respondía o si había un proxy por medio, la persona se
  iba a tocar su configuración para nada — y esa es la primera impresión que se lleva de Cortex.
  Ahora distingue el 404, los permisos y la red, y si no es ninguno de los tres enseña lo que
  dijo npm en lugar de inventarse una causa.

### Changed
- **La búsqueda deduce el tipo cuando la pregunta lo nombra.** «¿Qué deuda técnica hay alrededor
  de la facturación?» no recuperaba ninguna de las dos entradas correctas: los cinco resultados
  hablaban de facturación y ninguno era deuda técnica, porque «deuda técnica» aporta muchísimo
  menos al embedding que «facturación». Ahora ese tipo se empuja hacia arriba, **sin filtrar**
  —filtrar perdería la respuesta cuando está guardada con otro tipo—. recall@5 0.961 → 0.987 y
  MRR 0.901 → 0.928 en el eval, sin mover las preguntas que ya iban bien. El tamaño del empujón
  se eligió por la curva del eval (`CORTEX_SEARCH_TYPE_BOOST`, 0.15).

### Added
- **`cortex-admin eval`: la recuperación ya se mide.** 40 preguntas en español con la evidencia
  anotada contra un corpus fijo que va en el repo (`tests/fixtures/eval/`), con recall@5 y MRR
  desglosados por tipo de pregunta —directa, parafraseada, repartida entre varias entradas,
  razonada— y dos preguntas cuya respuesta no está, para ver si la memoria aparenta saber lo que
  no sabe. `--verbose` enseña qué salió cuando algo falla, que es lo que dice por dónde
  arreglarlo. El corpus no sale de la memoria real a propósito: un eval sirve para comparar
  ejecuciones, y la memoria real cambia todos los días.

## [0.1.0] — 2026-09-12

Primera versión publicable. Cortex deja de ser un repo que se clona para convertirse en un
servidor que se despliega y un CLI que se instala: `npm i -g @dinacodelabs/cortex`, `cortex auth
login`, `cortex setup --all`, y los agentes de ese portátil ya leen y escriben en la memoria
del proyecto, sin claves de modelo y sin base de datos en local.

### Cambios de esta versión, en orden inverso de llegada

### Added
- **El context-pack avisa de las decisiones que se contradicen** (ADR-0035). Cuando dos entradas
  vigentes chocan, el pack las sigue entregando las dos —cuál sobra no se puede juzgar en
  automático sin arriesgarse a borrar la buena— pero ahora lo dice **al lado de cada una**, y
  cuál se registró antes cuando se sabe. Entre entradas se nombra el par; cuando la
  contradicción está entre entidades del grafo —el caso frecuente— solo se dice que esa zona
  está en disputa, porque afirmar un par concreto ahí sería mentira. Antes el pack las entregaba
  como si nada y el agente decidía a ciegas, y dos agentes distintos lo detectaron
  solos y lo advirtieron sin que nadie preguntara.
- **La memoria, como herramientas del agente en Pi** (ADR-0034). Cortex registra
  `cortex.mem_save`, `cortex.mem_search`, `cortex.mem_get_observation` y `cortex.mem_update`,
  que es lo que gentle-pi busca para ofrecer Cortex como almacén de su ciclo de trabajo. El
  prefijo no es decorativo: Pi se queda con la primera extensión que registra un nombre y lo
  hace **en silencio**, así que un `mem_save` a secas habría dejado inalcanzables las tools de
  quien ya tuviera otra memoria instalada. Con prefijo conviven, y gentle-pi las reconoce igual.
- **La API ya sabe leer.** Antes solo escribía: buscar existía únicamente por MCP, contra la
  base de datos, así que ni el CLI ni ninguna integración sin MCP podían consultar la memoria.
  Ahora hay `GET /search` (sin `slug`, acotada a lo que puedes ver; con `slug`, a ese proyecto),
  `GET /entries/:id` y `PATCH /entries/:id` para corregir título y contenido.
- **`cortex mem`**: guardar, buscar, leer y corregir desde el terminal, con `--json` para quien
  lo llama desde código. Es también el puente que usan las tools de Pi, para que la resolución
  del servidor y del token siga viviendo en un solo sitio.

### Changed
- **El paquete de npm pasa a llamarse `@dinacodelabs/cortex`.** El scope `@dinacode` ya está
  cogido en npm por una organización ajena, así que el nombre que declaraba el repo no se podía
  publicar: el release habría fallado con un 403 aunque el token fuera correcto. Cambia el
  nombre en todas partes —instalador, plugin, workflows, `cortex upgrade` y docs—; el comando
  para instalarlo pasa a ser `npm i -g @dinacodelabs/cortex`. `CORTEX_NPM_PACKAGE` sigue
  sirviendo para apuntar a otro paquete. Como la `0.1.0` nunca llegó a publicarse, no hay nada
  que redirigir ni nadie a quien avisar.

### Fixed
- **La memoria dejaba de llenarse de ecos de sí misma.** Cuando un agente guarda una decisión
  con la tool y, al cerrar la sesión, la destilación la vuelve a guardar con otras palabras, las
  dos entradas llegan con `sourceType` distinto (`manual` y `agent_session`). Las ramas de
  reconciliación exigen el mismo origen —para no reescribir conocimiento curado— y el umbral de
  «ya lo sé» está en 0.95, así que el par pasaba por el medio: medido sobre un proyecto con
  varios agentes, ese eco puntúa **0.86–0.88**. Ahora, entre orígenes distintos y por encima
  del umbral, se pregunta al reconciliador **solo para no escribir**: nunca se modifica ni se
  invalida nada, y lo peor que puede pasar es que no se añada algo que ya sabíamos.
- **El lint ya ve esos duplicados.** El listón era 0.88 para todo; ahora baja a 0.85 entre
  entradas del **mismo tipo**, que es donde cae el eco, y se mantiene entre tipos distintos,
  donde parecerse mucho es legítimo (la incidencia que motivó una decisión se parece a la
  decisión, y no sobra ninguna).
- **La captura de OpenCode no guardaba nada, en silencio.** OpenCode movió sus sesiones de
  ficheros JSON (`storage/{session,message,part}`) a una base SQLite (`opencode.db`). El lector
  seguía buscando el layout viejo, no encontraba nada, y el hook, que calla por diseño, salía
  con 0. Parecía configurado y no guardaba una sola sesión. Ahora lee la base y, si no está,
  el store de ficheros: un portátil con OpenCode antiguo sigue funcionando.
- **El CLI empaquetado perdía `node:sqlite`, y con él la captura de OpenCode y de Hermes.**
  esbuild reescribía `import("node:sqlite")` como `import("sqlite")` al hacer el bundle. Ese
  módulo no existe, la importación lanzaba y el `catch` devolvía vacío. Funcionaba desde las
  fuentes y no funcionaba instalado desde npm, que es la peor forma de que algo esté roto. Hay
  un test que ahora mira el propio bundle.
- Un id de entrada mal formado llegaba a Postgres y salía un 500. Es entrada de usuario: ahora
  responde lo mismo que un id que no existe.
- **Pi ya recibe contexto y captura al cerrar.** Los hooks se colgaban leyendo `stdin`: Claude
  Code escribe su JSON y **cierra** la tubería, pero Pi llama al CLI con `execFile`, que la deja
  abierta y muda. El `for await` sobre `process.stdin` no terminaba nunca, el hook moría por
  timeout y el agente arrancaba sin saber nada del proyecto, en silencio. Ahora la lectura tiene
  tope de tiempo y se salta entera cuando quien llama ya lo ha dicho todo por argumentos
  (`--cwd`, `--session`). La extensión de Pi, además, cierra `stdin` del hijo, usa el `cwd` de la
  sesión en vez del del proceso y **espera** a que el contexto llegue antes de inyectarlo.

### Added
- **Prompts para que lo instale tu agente.** Dos bloques en el README, listos para pegar en
  Claude Code, Codex o el que sea: uno instala y configura la máquina entera, otro conecta un
  repositorio más. Son explícitos con lo único que un agente no puede hacer por ti, que es
  leer el código que te llega por correo, y con que pare si algo falla en vez de buscarse la
  vida.
- **Varios Cortex a la vez** (ADR-0033). El servidor es una propiedad del repositorio:
  `.cortex.json` admite un campo `server` y las credenciales guardan una sesión por servidor,
  leyendo el formato anterior sin obligar a volver a entrar. Los hooks, el CLI y el proxy MCP
  resuelven a cuál hablar desde la carpeta en la que se está trabajando, y el token se busca
  por servidor. Con más de una sesión, `cortex link --create` exige decir en cuál: es el único
  punto donde se podría crear el proyecto de un cliente en el servidor de otro.
  `cortex auth status` y `cortex doctor` comprueban todos. Nuevo `cortex auth use <url>`.
- **Modo local, para probar Cortex sin desplegar nada** (`deploy/local.yml`): un compose que
  levanta Postgres, la API, la UI y el MCP en `127.0.0.1` con un solo comando, sin dominio,
  sin TLS, sin claves y sin pedir una sola variable de entorno. Los datos sobreviven a un
  reinicio, porque una memoria de proyecto solo demuestra su valor cuando lleva semanas
  acumulando. Antes, la única forma de verlo funcionando era montar el despliegue de
  producción entero.

### Changed
- El correo del código de acceso, en inglés. Es el único texto del producto que le llega a
  alguien fuera de la aplicación, y se había quedado atrás.
- **La UI web, en inglés.** Con esto, todo lo que ve alguien de fuera lo está: CLI, tools
  MCP, lo que devuelven, el plugin, el README y la web. Los ADRs, el roadmap y los
  comentarios del código siguen en español, que es el registro de trabajo del equipo.
- **El texto que devuelven las tools MCP, en inglés.** En el pase anterior se tradujeron las
  descripciones de las tools pero no lo que devuelven, que es justo lo que el agente lee y a
  menudo repite al usuario: el context pack, los resultados de búsqueda, el informe de lint y
  la confirmación al guardar. El contenido de cada entrada conserva el idioma en que se
  escribió; lo que se traduce es el andamiaje.
- **README en inglés y la guía de interioridades como página propia**
  (`docs/how-it-works.md`, 498 líneas). El README pasa de 872 líneas a 407 y se queda con lo
  práctico; la guía que explica embeddings, RAG, el grafo y los siete agentes desde cero vale
  más como pieza enlazable que enterrada en la línea 400 de un README. Se corrigieron siete
  afirmaciones que ya no eran ciertas, verificadas contra el código: modelos por defecto,
  proveedores, troceado de documentos, dimensiones de embedding y umbrales configurables.
- Documentación consolidada para la v0.1.0: el roadmap deja de listar como pendiente lo que
  ya está hecho y se queda con lo que falta de verdad; el README, `CLAUDE.md` y
  `CONTRIBUTING.md` describen el producto que hay hoy, no el que se clonaba. Hay tests que
  vigilan los enlaces internos, los ADR citados y que no se cuele material corporativo.

### Added
- **Despliegue de producción completo** (ADR-0027): imagen de tres etapas sin
  devDependencies ni fuentes, corriendo como usuario `node`; Caddy delante con TLS
  automático y un solo dominio (`/` la web, `/api` la API, `/mcp` el MCP, `/install.sh` el
  instalador); Postgres sin puertos publicados; copia diaria con retención 7d/4s/6m;
  `deploy/restore.sh` con modo simulacro y `deploy/backup-now.sh`; y `deploy/README.md` con
  los procedimientos de actualizar, restaurar y rotar credenciales.
- **`/health` de verdad** en API, web y MCP: hace `select 1` y devuelve 503 si la base no
  responde. Antes decían `ok` mientras el proceso viviera, que es justo lo que no hay que
  decirle a un orquestador. El worker, que no escucha en ningún puerto, deja un fichero de
  latido que el compose vigila.
- Cabeceras de seguridad en las tres apps y `CORTEX_BIND_HOST` para elegir en qué interfaz
  escuchan. Por defecto, solo local: asomarse a la red es una decisión de quien despliega.
- **El CLI se publica en npm como `@dinacodelabs/cortex`**: un solo fichero de ~110 KB con
  `@cortex/client` y `@cortex/shared` dentro, y solo tres dependencias públicas fuera (el SDK
  de MCP, zod y yaml). Instalado global ocupa 24 MB, frente a los ~235 MB del clon del
  monorepo que hacía falta antes.
- **`cortex version`** (y `--version`): la versión del CLI, la del servidor y la versión
  mínima de cliente que el servidor exige. **`cortex upgrade`** instala la última publicada y
  recuerda pasar `cortex setup --all` después.
- **`cortex doctor`**: comprueba de una vez Node, la sesión, el servidor, el token, el MCP, el
  vínculo de esta carpeta y la integración de cada agente, y dice qué comando arregla cada
  fallo. Sale con código 1 solo si algo impide de verdad que Cortex funcione.
- **`cortex toolbelt sync|doctor`**: instala el registry de tu organización (MCPs, skills y
  comandos de terceros) en los agentes detectados. Simulacro por defecto, `--apply` para
  escribir. Una entrada a la que le falte su variable de entorno se omite con un aviso: un MCP
  registrado y roto es peor que uno ausente.
- **`cortex setup` cubre los cinco agentes**: Claude Code y Codex comparten plugin (Codex lee
  el mismo marketplace; solo su MCP se registra aparte), OpenCode recibe un plugin JS que
  inyecta el contexto y captura al quedarse la sesión inactiva, Pi una extensión que inyecta
  el contexto como mensaje de sesión y captura al cerrarla, y Hermes sus hooks y su MCP en
  `config.yaml`. Todos con copia de seguridad, idempotencia y `--remove`.
- **`cortex hook-capture --platform`** con detección automática: como el plugin es el mismo
  para varios agentes, el hook deduce cuál es por la ruta del transcript. Acepta `--session`
  (id o ruta) y `--cwd`, y en Codex, si el evento no trae ninguno de los dos, usa la sesión
  más reciente de ese repo.
- **Lectores de sesión por agente**: Pi (nuevo), y las variantes «una sola sesión» de Codex,
  OpenCode y Hermes que necesita el hook. `cortex connect-sessions` acepta ya `pi`.
- **`cortex setup <agente>|--all`**: instala la integración de Cortex en los agentes de tu
  equipo con el mecanismo nativo de cada uno. Idempotente, con copia de seguridad antes de
  tocar nada, `--dry-run`, `--remove` y `--status`. Instalar el CLI y configurar los agentes
  pasan a ser dos cosas distintas: se puede reconfigurar sin reinstalar (ADR-0032).
- **Plugin de Claude Code** (`plugin/claude-code/`, marketplace `dinacode-cortex` declarado
  en este mismo repo): hooks de contexto y captura, el MCP `cortex mcp`, la skill
  `cortex-capture` y `/cortex-save` en un solo paquete que el usuario ve y controla desde
  `/plugin`. Si no se puede instalar (repo privado sin acceso), `setup` cae a hooks en
  `~/.claude/settings.json` y funciona igual.
- **Migración desde la instalación anterior**, dentro del propio `cortex setup`: los hooks
  `pnpm -C <clon> cortex hook-*` se sustituyen en su sitio en vez de duplicarse, el MCP que
  apuntaba al repo clonado se vuelve a registrar contra el servidor, los symlinks a `config/`
  se retiran y el shim de `~/.local/bin/cortex` se borra. El clon en `~/.dinacode-cortex` se
  avisa pero no se toca: puede tener un `.env` con claves.
- **`cortex mcp`**: servidor MCP por stdio que hace de puente hacia el MCP HTTP del
  servidor, autenticado con el token de `cortex auth login`. Es lo que se registra en los
  agentes (`claude mcp add cortex -- cortex mcp`): el proceso local no toca la base de datos
  y las tools respetan los permisos del usuario. Si no hay sesión o el token ha caducado, el
  agente **arranca igual** (lista de tools vacía y aviso), en vez de fallar al inicializarse
  (ADR-0025).
- `CORTEX_HOME` sustituye a `~` al buscar `~/.cortex/credentials`, para poder usar una
  sesión aparte en pruebas sin pisar la del usuario.
- **`cortex-admin`**: los comandos de operador (migrate, seed, ingest, maintain, enrich,
  lint, conectores pesados y los servicios) salen del CLI a su propia app, que vive en la
  imagen de despliegue. El CLI `cortex` se queda con lo de developer y deja de depender de
  Postgres, Mastra y la extracción documental (ADR-0025).
- **Destilación de sesiones en el servidor** (`POST /capture/session`): los hooks mandan el
  transcript condensado y escrubado, y el servidor lo destila con su propia clave. Ningún
  portátil necesita ya credenciales de LLM. Idempotente por sesión —los hooks disparan
  varias veces sobre la misma— y si la sesión creció solo se destila la parte nueva
  (ADR-0025).
- **Endpoints nuevos en la API**: `GET /client-config` (público: la URL del MCP, la versión
  y la versión mínima de cliente, para que el CLI no adivine nada), `GET /version`,
  `GET /toolbelt.json`, `GET /projects/:slug` y `POST /projects`. Con ellos, `cortex link`
  deja de necesitar Postgres.
- **`@cortex/client`**: paquete nuevo con todo el lado cliente (credenciales, HTTP, cliente
  tipado de la API, `.cortex.json`, transcripts). Depende solo de `@cortex/shared`, sin
  Postgres ni Mastra, que es lo que permitirá distribuir el CLI con `npm i -g` (ADR-0025).
  Los contratos de la API pasan a `shared/api-contract.ts`, compartidos por servidor y
  cliente para que no se desincronicen.
- **Build compilado**: `pnpm build` (`tsc -b` con project references) genera `dist/` en cada
  paquete y app de servidor, y Docker arranca `node dist/...` en vez de transpilar con `tsx`
  en cada arranque. Desarrollar sigue sin requerir build gracias a una condición
  `development` en los `exports` (ADR-0030).
- Proveedor `openai-compatible` para LLM y embeddings: sirve para NaN, Ollama, vLLM o
  LM Studio con la misma configuración. `CORTEX_MODEL_<ROL>` admite `proveedor:modelo` para
  mandar un solo rol a otro proveedor (ADR-0024).
- Semáforo `CORTEX_LLM_CONCURRENCY` (def. 4) compartido por chat, visión, STT y embeddings:
  el límite del proveedor es por API key, no por endpoint.
- `CORTEX_PRICING_JSON` para corregir o dar de alta precios de modelos sin desplegar.
- Marca configurable: `CORTEX_BRAND_NAME` y logo por `CORTEX_BRAND_LOGO_SVG` /
  `CORTEX_BRAND_LOGO_FILE` (ADR-0013 revisado).
- Email transaccional enchufable: `CORTEX_EMAIL_PROVIDER=log|brevo|smtp`, validado al
  arrancar el servidor (ADR-0028).
- Licencia Apache-2.0, `NOTICE`, `SECURITY.md`, código de conducta, plantillas de issue/PR y
  Dependabot (ADR-0029).
- `docs/toolbelt-registry.md`: esquema del registry para que una organización declare su
  propio toolbelt fuera de este repo.

### Removed
- **`cortex sync`**. Hacía dos cosas a la vez: instalar Cortex y repartir las herramientas de
  la empresa. Ahora son `cortex setup` y `cortex toolbelt sync`, y quien escriba el comando
  viejo recibe un mensaje que lo explica. Con él se va el shim de `~/.local/bin`.

### Changed
- **La superficie de producto pasa a inglés**: las descripciones de las 8 tools MCP (las lee
  un modelo que puede estar trabajando en cualquier idioma), los mensajes del CLI, la skill
  `cortex-capture`, `/cortex-save` y los errores de la API que consume el CLI. Los prompts de
  los agentes LLM siguen en español —el corpus lo es—, y también los ADRs, el roadmap y los
  comentarios del código. La UI web se traduce más adelante.
- **`install.sh` ya no clona el repo**: instala el CLI desde npm, inicia sesión y llama a
  `cortex setup --all`. Node no se instala por su cuenta —meterle una versión a alguien por
  detrás le rompe otros proyectos—, se exige ≥ 20 y se dan tres formas de ponerlo. Los fallos
  típicos (npm sin permisos, `cortex` fuera del PATH) traen el comando exacto que los arregla.
- `cortex link` va por la API en vez de por la base de datos: era el último comando del CLI
  que necesitaba Postgres.
- `cortex hook-capture`, `connect-sessions` y `connect-meeting` ya no llaman al modelo: solo
  condensan y envían. El pipeline que destilaba en el cliente desaparece.
- La documentación de **proceso interno** (auditoría de seguridad, plan de refactor,
  estrategia de modelos con costes y la investigación de ingesta atada a un proveedor) sale
  del repo: abrir el código no es abrir el proceso. El criterio de qué se publica y qué no
  está en el ADR-0031.
- `nan` pasa a ser un **alias obsoleto** de `openai-compatible` (avisa al usarse; se retira
  en 0.2.0). Igual para `EMBEDDINGS_PROVIDER=nan`.
- `CORTEX_AUTH_DOMAIN` y `BREVO_SENDER` pierden su valor por defecto: dependían del dominio
  de quien escribió el producto. Sin `CORTEX_AUTH_DOMAIN` cualquiera puede registrarse, y el
  servidor lo avisa al arrancar.
- El toolbelt corporativo sale del repo a uno privado; `config/toolbelt.json` queda con lo
  del producto (ADR-0014 revisado, ADR-0026).
- Fixtures de tests a `example.com`; referencias a clientes reales neutralizadas.
- `xlsx` se instala desde el CDN oficial de SheetJS (0.20.3) en vez de npm, cuya versión
  está abandonada con dos CVE sin corregir.

### Fixed
- Si el comando que la extensión de Pi ejecuta falla, ahora lo dice por stderr. Antes se lo
  tragaba y el agente arrancaba sin contexto sin que nada lo indicara.
- **La memoria dejaba de reconocer lo que ya sabía si venía de otro sitio.** El NOOP de la
  reconciliación exigía que coincidiera el `sourceType`, así que una entrada destilada de una
  sesión nunca se comparaba con la misma información capturada a mano. El efecto, visto
  probando con agentes de verdad: el agente repite en su respuesta lo que la memoria acaba de
  contarle, la captura lo destila, y la memoria se va llenando de ecos de sí misma. Ahora
  reconocer un casi-idéntico no depende del origen. Modificar conocimiento curado sigue
  exigiéndolo, que es lo que de verdad había que proteger.
- **`cortex setup` ya no se cae ante un symlink roto** de la instalación anterior. Al mover
  la skill y el comando dentro del plugin, los enlaces que dejó `cortex sync` apuntando al
  repo clonado quedaron colgando, y escribir a través de uno falla con ENOENT. Tumbaba el
  `setup --all` entero. Ahora el enlace se sustituye por un fichero de verdad, lo que además
  arregla el caso peor: con un enlace VIVO se estaría escribiendo dentro del repo de otro.
  Encontrado migrando una máquina real.
- **Una clave de inferencia rechazada ya no pasa por «no había nada que guardar».** El
  destilador se tragaba cualquier error de la ventana, así que un 401 del proveedor devolvía
  `saved: 0, failed: 0` y estado `done`: todo verde, cero conocimiento, y así indefinidamente.
  Ahora un rechazo del proveedor sale hacia arriba y la captura se marca fallida con su
  motivo. Lo demás (JSON inválido, una ventana que no da nada) se sigue saltando, que sí es
  recuperable. Encontrado al desplegar el servidor de producción.
- Los tres errores de alta que ve un usuario (email mal escrito, dominio no permitido,
  demasiados códigos seguidos) estaban aún en español. Se descubrieron al desplegar: son lo
  primero que lee alguien que intenta entrar y no puede.
- `cortex link` ya no revienta al listar si un proyecto antiguo no tiene slug. Un dato viejo
  tumbaba el comando entero en vez de listar los demás.
- `scrub()` se aplica en **todos** los caminos de captura: hasta ahora solo los transcripts
  de Claude llegaban limpios al modelo; los de Codex, OpenCode, Hermes y las reuniones iban
  crudos. Además el servidor vuelve a limpiar lo que recibe, sin fiarse del cliente.
- `resolveEntities` agrupaba por nombre ignorando el tipo, así que fusionaba entidades
  distintas y borraba la perdedora sin vuelta atrás. Ahora la clave incluye el tipo.
- La elección de entidad canónica no tenía desempate estable y dependía del orden de filas
  de Postgres; era la causa de un test de integración intermitente.
- `loadEnv` resolvía el `.env` relativo a su propio fichero fuente, así que se rompía al
  compilar o al mover el paquete. Ahora busca por `CORTEX_ENV_FILE`, `INIT_CWD` y cwd.
- Una variable de entorno declarada pero vacía no caía a su valor por defecto:
  `EMBEDDINGS_PROVIDER=` reventaba el arranque en vez de usar `local`, y una clave vacía
  cortaba la cadena de fallback.
