# Cobertura de requisitos vs el plan fundacional — Auditoría Cortex

## Valoración

La cobertura del plan fundacional (`dinacode-cortex-contexto-y-plan-demo.md`) es **alta en lo
estructural** y razonablemente **honesta en la documentación**. El modelo de datos del §14 está
implementado casi al pie de la letra (la migración `0001_init.sql` reproduce
`context_entries`/`entities`/`relations`/`sources`/`embeddings` con sus enums exactos), las 5 tools
MCP mínimas del §16/§20.5 están todas y ampliadas a 8, los embeddings son realmente enchufables
(ADR-0005) y la trazabilidad del §5.5 tiene columnas dedicadas. Las hipótesis declaradas se han
validado o documentado con honestidad (Mastra "parcialmente validada" con hallazgo real en
ADR-0006/0015; MCP y embeddings validados en código). El sistema incluso **excede** el plan en
bi-temporalidad, indexado de código, búsqueda híbrida+RRF y observabilidad de coste.

No está a la altura de un sistema de primera línea en **un punto que sí compromete el plan**: el
filtrado por permisos que el §7/§8/§18 y el Riesgo 5 exigen en *todos* los caminos de recuperación
está implementado pero **tiene fugas** en búsqueda/ask sin proyecto (promesa entregada de forma
incorrecta y contradicha por el propio README). El resto de huecos son de cobertura honesta pero
incompleta: sin auditoría de accesos, sin el loop §12.8, sin reindexado al cambiar de modelo de
embeddings, y sólo 1 de los 3 workflows Mastra del §20.4 como workflow real.

## Hallazgos por severidad

### 🟠 Alto

#### A1. El "filtrado por permisos" exigido en retrieval no se aplica en búsqueda/ask sin proyecto

- **Evidencia.** El plan lo exige explícitamente: §7 Retrieval Agent ("filtrado por permisos"),
  §8/§18 MCPs ("¿Cómo limitamos contexto por proyecto/cliente?"), Riesgo 5 (confidencialidad).
  Pero `searchContext` pasa `projectId = null` cuando no se filtra
  (`packages/core/src/operations.ts:243`: `parsed.project ? findProjectId(...) : null`) y
  `hybridSearch`/`vectorSearch` sólo aplican `ce.project_id` si `projectId` es truthy
  (`packages/core/src/vectors.ts:84` y `:171`), devolviendo entradas de **todos** los proyectos.
  El guard del MCP retorna `null` = permitido cuando no hay proyecto
  (`apps/mcp-server/src/server.ts:47`: `if (!user || !project) return null;`) y la web `/search`
  y `/ask` no post-filtran los hits (`apps/web/src/index.ts`), a diferencia del listado `/` que sí
  filtra. El README, en cambio, afirma permisos aplicados ("atribución + permisos; ya no tocan la
  BD directa", `README.md:109,178`).
- **Impacto.** El aislamiento por proyecto/cliente —central para un producto interno con datos de
  varios clientes (Riesgo 5)— se puede eludir: cualquier usuario autenticado lee memoria de
  proyectos privados ajenos buscando/preguntando sin proyecto. Es a la vez fuga de seguridad,
  requisito de cobertura no cumplido y hueco doc-vs-código. (No es crítico: requiere usuario interno
  autenticado, no acceso anónimo).
- **Recomendación.** Empujar la autorización a `core`: `searchContext`/`ask` deben recibir el email
  y restringir **siempre** a los proyectos accesibles (`listAccessibleProjects`) cuando no se pasa
  proyecto, en vez de un guard opt-in por nombre. Política por defecto: **denegar**. Unificar la
  resolución de proyecto (`findProjectByName` vs `findProjectId`).
- **Esfuerzo.** M

### 🟡 Medio

#### M1. No hay auditoría de accesos pese a que el plan la exige (§18 MCPs)

- **Evidencia.** El plan pregunta directamente "¿Cómo auditamos accesos?" (§18 MCPs,
  `dinacode-cortex-contexto-y-plan-demo.md:1545`) y lista "auditoría" como mitigación del Riesgo 5
  (`:1614`). La única observabilidad implementada es de coste/uso LLM (`0005_llm_usage`) y trazas de
  IA (`0006_ai_traces`), sin columna de actor/usuario; existe identidad (`0009_auth`: `users`,
  `auth_tokens`) pero no se registra **quién consultó/guardó qué** contexto ni en qué proyecto (no
  hay tabla de access/audit log en el repo).
- **Impacto.** Para una memoria corporativa con datos sensibles de clientes, no poder reconstruir
  quién accedió a qué conocimiento es un hueco de cumplimiento y seguridad. `created_by` da
  atribución de escritura, pero no hay traza de lectura/consulta. (Medio: §18 es lista de preguntas
  abiertas de una PoC, no requisito comprometido).
- **Recomendación.** Añadir un log de accesos (tool MCP invocada, usuario, proyecto, timestamp, nº
  de hits) reutilizando la infra de `ai_traces`; al menos para `search`/`ask`/`get_context_pack`/
  `validate`. Es la pieza natural sobre la que montar el RBAC ya esbozado.
- **Esfuerzo.** M

#### M2. El loop §12.8 (aprendizaje desde consultas) no está implementado ni figura como pendiente

- **Evidencia.** El §12.8 describe detectar lagunas cuando muchos developers preguntan lo mismo. No
  existe logging de consultas (no hay `query_log`/`search_log` en `packages/core` ni `apps`). El
  `gaps` del lint (`packages/core/src/lint.ts:86,107`) es algo distinto: áreas con incidencias pero
  sin decisiones, no frecuencia de preguntas. Ni `docs/roadmap.md` ni `docs/decisions.md` mencionan
  el 12.8.
- **Impacto.** De los 10 loops del §12, 9 están cubiertos (dedup, obsolescencia, enriquecimiento,
  resolución de entidades, contradicciones, baja confianza, consolidación vía pack/lint, limpieza de
  ruido vía distiller, context-pack). El 12.8 es el único totalmente ausente y, al no estar en el
  roadmap, hay una pequeña deshonestidad por omisión en la cobertura declarada.
- **Recomendación.** O implementarlo (registrar consultas y detectar clusters repetidos sin
  respuesta para abrir "huecos"), o documentarlo explícitamente como descartado/pendiente en
  `roadmap.md` para que la cobertura del §12 sea trazable.
- **Esfuerzo.** M

#### M3. Sin reindexado/versionado operativo de embeddings al cambiar de modelo (§9.2/§9.6)

- **Evidencia.** El plan pregunta repetidamente "¿Cómo versionamos embeddings?" y "¿Cómo
  reindexamos si cambiamos de modelo?" (§9.2, §9.6). El esquema tiene
  `embedding_model`/`embedding_version`/`dim` (`packages/database/.../0001_init.sql:129-131`) pero no
  hay comando para re-embeber `context_entries` existentes al cambiar `EMBEDDINGS_PROVIDER`; sólo
  existe reindexado de `code_chunks` por repo (`packages/core/src/code.ts:237`). Además el self-join
  de dedup filtra por modelo pero no por versión (`lint.ts`), por lo que conviven versiones sin
  estrategia.
- **Impacto.** El fallback local (no semántico, ADR-0005) está pensado para sustituirse por un
  proveedor real, pero al hacerlo no hay forma soportada de reindexar el corpus ya guardado: las
  entradas viejas quedan con vectores incomparables (incluso de dimensión distinta) con los nuevos.
  Requisito de evolución de embeddings no cubierto.
- **Recomendación.** Añadir un comando `reembed --provider X` que recompute embeddings de
  `context_entries` por proyecto y marque `embedding_version`; filtrar búsquedas/dedup por
  `(model, version)` consistente.
- **Esfuerzo.** M

#### M4. Sólo 1 de los 3 workflows Mastra del §20.4 está implementado como workflow real

- **Evidencia.** El §20.4 pide tres workflows: `captureContextWorkflow`,
  `generateContextPackWorkflow` y `detectDuplicateOrContradictionWorkflow`. Sólo
  `captureContextWorkflow` existe como workflow Mastra (`packages/agents/src/workflows.ts:86`). El
  context-pack y la detección de duplicados/contradicciones son funciones deterministas de `core`,
  no workflows Mastra observables. ADR-0006 lo reconoce honestamente como pendiente ("ampliar a los
  demás workflows del §20.4").
- **Impacto.** La hipótesis "Mastra orquesta workflows" (idea 2 de la demo, §21) queda demostrada de
  forma mínima. No es un hueco grave —el valor funcional existe en `core`— pero la cobertura del
  §20.4 es parcial y la demostración del motor de workflows es escasa.
- **Recomendación.** Mantener si la prioridad es funcionalidad; si se quiere defender la hipótesis
  Mastra, envolver context-pack y dedup/contradicción en `createWorkflow` para tener pasos
  observables. Ya está marcado como pendiente: dejarlo así es aceptable.
- **Esfuerzo.** M

#### M5. La redacción de secretos (anonimización §18/Riesgo 3-5) no se aplica de forma uniforme

- **Evidencia.** El plan exige "¿Cómo anonimizamos o protegemos datos sensibles?" (§18 Datos) y
  separar inferencias de hechos (Riesgo 3). `scrub()` existe pero sólo el camino Claude lo aplica
  antes de enviar al LLM; los lectores de Codex/OpenCode/Hermes y connect-meeting destilan sin scrub
  (`packages/agents/src/session-readers.ts:22` → `connect-sessions.ts:153`), filtrando secretos en
  claro al proveedor. El `scrub` final sólo limpia lo que se persiste.
- **Impacto.** La protección de datos sensibles en la captura automática (la vía de mayor riesgo,
  transcripts con `.env` pegados) está cubierta a medias: defensa en el camino principal pero fugas
  en los conectores no-Claude. Cobertura parcial de un requisito de confidencialidad explícito.
- **Recomendación.** Centralizar `scrub()` en el pipeline compartido (`captureCondensedViaApi`) para
  que se aplique antes de cualquier llamada LLM, sea cual sea el lector de origen; añadir cobertura
  de connection strings/cookies.
- **Esfuerzo.** S

### 🟢 Bajo / Bien

#### B1. Modelo de datos §14 implementado fiel y completo (mantener)

- **Evidencia.** `0001_init.sql` reproduce el §14 casi literalmente: `sources` (10 `source_type`),
  `entities` (11 tipos + unicidad `(type, canonical_name)`), `context_entries` (14 `type`, 6
  `status`, 4 `confidence`, `validity`), `relations` (10 `relation_type` polimórficas), `embeddings`
  (`model`/`version`/`dim`/`vector`/`chunk_index`). El comentario del fichero cita el §14
  explícitamente. La trazabilidad §5.5 tiene columnas dedicadas.
- **Impacto.** El núcleo del plan —el modelo de conocimiento trazable— está entregado completo y
  verificable contra el documento fundacional. Base sólida del resto.
- **Recomendación.** Mantener. Pulir sólo la deuda de tipado (`Row = Record<string, any>` en
  `map.ts:4`), ajena a la cobertura del modelo.
- **Esfuerzo.** S

#### B2. Las 5 tools MCP mínimas (§16/§20.5) están todas, ampliadas a 8 (mantener)

- **Evidencia.** `apps/mcp-server/src/server.ts` registra `save_project_context`,
  `search_project_context`, `get_project_context_pack`, `list_project_decisions`,
  `validate_context_entry` (las 5 del §20.5) más `ask_project_context`, `search_project_code` y
  `lint_project_context`. Tools neutras y portables (ADR-0007/0014), expuestas por stdio y HTTP
  autenticado.
- **Impacto.** La interfaz neutra que el plan exige (§8) está cubierta y excede el mínimo. La idea 3
  de la demo (§21) está respaldada.
- **Recomendación.** Mantener. Nota menor: la versión del `McpServer` está hardcodeada a `"0.0.0"`
  (`server.ts:42`); reflejar la versión real.
- **Esfuerzo.** S

#### B3. Embeddings y LLM realmente enchufables con fallback local (ADR-0005 validado) (mantener)

- **Evidencia.** `packages/embeddings/src/index.ts:18-40` selecciona proveedor por
  `EMBEDDINGS_PROVIDER` (`local | openai | nan | voyage`) con default `local` sin claves. El LLM se
  inyecta vía `setClassifier`/`setReranker`/`setReconciler` desde los entrypoints sin que `core`
  dependa de `agents` (ADR-0008). La hipótesis de pluggability (§9.5/§9.6) está validada en código.
- **Impacto.** Cumple "arrancar sin configurar nada y conectar un proveedor real trivialmente".
  Reduce el acoplamiento a un proveedor (§9).
- **Recomendación.** Mantener. Pendiente conocido: el embedding `local` no es semántico
  (documentado), y whisper/visión están atados al provider `nan` (no tan enchufables como el texto).
- **Esfuerzo.** S

#### B4. Existe una suite de tests, contradiciendo la premisa "Sin tests" — pero cobertura parcial

- **Evidencia.** `tests/` contiene `auth.test.ts`, `domain.test.ts`, `project-config.test.ts`,
  `session-readers.test.ts` e integración (core, auth, permissions) con BD real
  (`vitest.integration.config.ts`). Cubren allowlist de email, schemas zod, slugify/readCortexLink,
  lectores de sesión, búsqueda híbrida, herencia jerárquica, `captureBatch`, NOOP de reconciliación
  y permisos público/privado/cascada. **No** cubren: RRF, polaridad de contradicciones, chunking de
  código, los caminos ADD/UPDATE/SUPERSEDE del reconciler, ni canonicalización.
- **Impacto.** Los mapas de subsistemas afirman repetidamente "Sin tests"; es inexacto. Hay red de
  seguridad para auth, permisos y el flujo básico de persistencia, pero la lógica más sutil
  (umbrales de dedup/contradicción, fusión RRF, decisiones del reconciler) sigue sin cobertura. El
  roadmap aún lista "Tests" como pendiente (`roadmap.md:291`), una deriva menor.
- **Recomendación.** Actualizar `roadmap.md` para reflejar la suite existente y priorizar tests de
  las heurísticas críticas no cubiertas (RRF, polaridad, caminos del reconciler), justo las que más
  fácilmente regresan en silencio.
- **Esfuerzo.** M

#### B5. Deriva menor del roadmap: "no hay server aún" cuando server y despliegue ya existen

- **Evidencia.** `docs/roadmap.md:251` ("no hay server aún") y `:292` ("de momento no hay server")
  contradicen la realidad: existe `apps/server/src/index.ts` (API+auth), `deploy/docker-compose.yml`
  y la última entrada de `decisions.md` documenta el despliegue docker-compose como "Verificado".
  Igualmente, el scheduler/worker descrito como dependiente de un server inexistente ya tiene
  `maintain:worker` e imagen.
- **Impacto.** El roadmap es por lo demás honesto y detallado (marca "hecho (v1)" + "Pendiente" por
  bloque), pero estas frases stale pueden inducir a creer que falta infraestructura ya presente.
  Riesgo bajo, pero el `CLAUDE.md` insiste en mantener la doc viva.
- **Recomendación.** Pasar una poda al roadmap: eliminar los "no hay server aún", mover a "hecho" el
  despliegue y el worker en compose, y registrar el estado real del scheduler (worker ya cableable).
- **Esfuerzo.** S

## Qué está bien

- **Modelo §14 fiel y completo** (B1): el corazón trazable del plan está entregado y verificable
  contra el documento fundacional.
- **Interfaz MCP §16/§20.5 completa y excedida** (B2): 5 tools mínimas + 3 extra, neutras y
  portables, por stdio y HTTP autenticado.
- **Pluggability real de embeddings/LLM** (B3): default local sin claves, inyección de inteligencia
  sin acoplar `core`.
- **Excede el plan**: bi-temporalidad, indexado de código, búsqueda híbrida+RRF y observabilidad de
  coste/uso LLM no estaban en el mínimo y están entregados.
- **Honestidad documental**: las hipótesis declaradas se validaron o registraron con franqueza
  (Mastra "parcialmente validada" con hallazgo real, ADR-0006/0015); existe una suite de tests real
  (B4).

## Recomendaciones priorizadas

1. **(Alto, M) Cerrar la fuga de permisos en retrieval** (A1): empujar la autorización a `core`,
   restringir siempre a proyectos accesibles cuando no se pasa proyecto (default denegar), y
   reconciliar el README con el comportamiento real.
2. **(Medio, S) Centralizar `scrub()` antes de cualquier llamada LLM** (M5): cerrar las fugas de
   secretos en los lectores no-Claude; bajo esfuerzo, alto retorno de confidencialidad.
3. **(Medio, M) Añadir log de accesos** (M1): reutilizar la infra de `ai_traces` para search/ask/
   pack/validate; base natural del RBAC ya esbozado.
4. **(Medio, M) Comando `reembed` + filtrado por `(model, version)`** (M3): habilitar la evolución
   de embeddings sin dejar corpus incomparable.
5. **(Medio, M) Resolver el loop §12.8**: implementarlo o documentarlo explícitamente como
   pendiente/descartado para que la cobertura del §12 sea trazable (M2).
6. **(Bajo, S) Poda de documentación**: eliminar los "no hay server aún" del roadmap y reflejar la
   suite de tests existente (B5, B4); ampliar workflows Mastra del §20.4 sólo si se quiere defender
   esa hipótesis (M4).
7. **(Bajo, S) Limpieza menor**: versión real del `McpServer` (B2) y tipado de `Row` en `map.ts`
   (B1).
