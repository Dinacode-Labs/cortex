# Dinacode Cortex: contexto, planteamiento y plan para demo funcional

> Documento de trabajo para estudiar, debatir y plantear una demo funcional de Dinacode Cortex.
>
> **Importante:** todo lo planteado en este documento debe considerarse una hipótesis inicial. Cada decisión técnica, herramienta, flujo, abstracción y prioridad debe ser cuestionada, analizada, cotejada con alternativas reales y validada antes de implementarse de forma definitiva.

---

## 1. Contexto general

Dinacode Cortex es una propuesta de plataforma interna de conocimiento y contexto para una consultora de software.

El problema principal no es simplemente almacenar documentación. El problema real es que en proyectos de software grandes el conocimiento crítico queda distribuido entre:

- desarrolladores concretos;
- decisiones tomadas meses o años atrás;
- repositorios de código;
- issues, tickets y tareas;
- comentarios en pull requests;
- documentos sueltos;
- conversaciones internas;
- correos con clientes;
- reuniones;
- chats;
- herramientas de IA como Claude Code, Codex, ChatGPT o similares.

En una consultora de software, el contexto de un proyecto es una de las partes más costosas de adquirir. Un desarrollador puede necesitar semanas o meses para entender correctamente:

- por qué se tomó una decisión técnica;
- qué restricciones tiene un cliente;
- qué partes del sistema son sensibles;
- qué errores ya se cometieron;
- qué soluciones se probaron y se descartaron;
- qué convenciones internas tiene un proyecto;
- qué dependencias externas condicionan el desarrollo;
- qué partes del código no deberían tocarse sin cuidado;
- qué módulos tienen deuda técnica;
- qué información relevante no está documentada en ningún sitio claro.

La visión de Dinacode Cortex es construir una memoria corporativa inteligente orientada a proyectos software.

No se plantea como una wiki tradicional, sino como una capa viva de contexto reutilizable por personas y agentes de IA.

---

## 2. Frase resumen del proyecto

> **Dinacode Cortex aspira a convertirse en el cerebro compartido de los proyectos de Dinacode: una capa de contexto corporativo que permita capturar, relacionar, depurar y recuperar conocimiento técnico de forma útil para developers, agentes de IA y herramientas internas.**

Versión más técnica:

> **Dinacode Cortex es una plataforma de memoria corporativa para proyectos software, construida sobre agentes Mastra, MCPs corporativos y una capa híbrida de recuperación semántica y conocimiento relacional.**

---

## 3. Qué puede llegar a ser Dinacode Cortex

Dinacode Cortex nace de un problema habitual en consultoría software: el conocimiento de los proyectos está disperso entre personas, repositorios, tickets, conversaciones, decisiones técnicas y documentación parcial.

La idea es construir un sistema capaz de capturar y poner a disposición del equipo el contexto acumulado de cada proyecto.

Un desarrollador debería poder consultar preguntas como:

- ¿Qué debo saber antes de tocar este módulo?
- ¿Por qué se eligió esta arquitectura?
- ¿Qué problemas similares hemos tenido antes?
- ¿Qué restricciones tiene este cliente?
- ¿Qué decisiones técnicas siguen vigentes?
- ¿Qué conocimiento importante me estoy perdiendo?
- ¿Qué partes del proyecto son peligrosas o sensibles?
- ¿Qué histórico hay sobre esta funcionalidad?

El objetivo no es solamente hacer RAG sobre documentos. El objetivo es reducir la pérdida de conocimiento organizativo.

---

## 4. Objetivo inicial de la demo funcional

El objetivo de la demo no debería ser construir la plataforma definitiva, sino demostrar que el planteamiento es viable.

La demo debería incluir todos los bloques principales a pequeña escala, aunque sea con implementaciones simples, simuladas o mínimas.

### Objetivo principal de la demo

Construir un flujo funcional donde:

1. Se captura contexto de un proyecto software.
2. Se procesa mediante agentes y workflows con Mastra.
3. Se almacena en una capa de conocimiento.
4. Se expone mediante un MCP corporativo.
5. Claude Code puede consultar ese contexto durante una tarea.
6. El sistema queda preparado conceptualmente para que Codex pueda usar la misma capa más adelante.

### Restricción importante

La demo inicial debe funcionar principalmente con **Claude Code**, pero la arquitectura debe evitar acoplarse exclusivamente a Claude Code.

Debe plantearse como:

```text
Claude Code  ─┐
Codex        ─┼─> MCP corporativo ─> Dinacode Cortex
ChatGPT      ─┘
```

No como:

```text
Claude Code ─> integración ad hoc no reutilizable
```

---

## 5. Principios de diseño iniciales

Estos principios son hipótesis iniciales y deben debatirse.

### 5.1. Primero contexto de proyectos, después conversaciones

La prioridad inicial no debería ser ingerir todos los correos, chats o reuniones de la empresa.

El mayor valor está en capturar el contexto general de los proyectos software:

- decisiones técnicas;
- arquitectura;
- restricciones;
- convenciones;
- módulos críticos;
- problemas recurrentes;
- dependencias externas;
- histórico de incidencias;
- conocimiento de dominio;
- deuda técnica;
- decisiones descartadas.

Correos, llamadas, Google Chat, Teams o reuniones pueden complementar el sistema, pero no deberían ser la primera fuente crítica de valor.

### 5.2. Capturar antes que perfeccionar

Antes de diseñar una representación perfecta del conocimiento, hay que conseguir que el conocimiento entre en el sistema.

La captura debe ser:

- sencilla;
- rápida;
- poco intrusiva;
- validable;
- trazable;
- útil desde el primer momento.

### 5.3. No construir una wiki más

Dinacode Cortex no debería ser otro sitio donde los desarrolladores tengan que documentar manualmente todo.

La visión correcta es:

```text
La empresa trabaja → Cortex observa/captura → Cortex estructura → Cortex permite recuperar contexto
```

No:

```text
Los developers hacen su trabajo → después pierden tiempo documentando en otra herramienta
```

### 5.4. Humanos y agentes comparten contexto

El mismo conocimiento debería servir para:

- developers humanos;
- Claude Code;
- Codex;
- ChatGPT;
- agentes internos;
- herramientas de onboarding;
- bots de proyecto;
- futuras interfaces internas.

### 5.5. Trazabilidad y confianza

Cada pieza de conocimiento debería conservar:

- fuente original;
- fecha;
- autor o sistema de origen;
- proyecto relacionado;
- tipo de información;
- nivel de confianza;
- estado de validación;
- vigencia;
- relaciones detectadas.

---

## 6. Arquitectura conceptual propuesta

Arquitectura inicial de alto nivel:

```text
Fuentes de contexto
  ├─ Developers
  ├─ Repositorios
  ├─ Issues / tickets
  ├─ Pull requests
  ├─ Documentación
  ├─ Claude Code
  ├─ Codex
  ├─ Correos
  ├─ Chats
  └─ Reuniones

        ↓

MCPs internos securizados

        ↓

Mastra
  ├─ Agents
  ├─ Workflows
  ├─ Tools
  ├─ Memory
  ├─ RAG
  └─ Evals / observabilidad

        ↓

Capa de conocimiento
  ├─ Base documental
  ├─ Base vectorial
  ├─ Grafo de conocimiento
  └─ Metadatos / permisos / trazabilidad

        ↓

Consumidores
  ├─ Claude Code
  ├─ Codex
  ├─ ChatGPT
  ├─ UI interna
  ├─ Bots internos
  └─ Agentes especializados
```

---

## 7. Papel de Mastra

La decisión inicial es que los agentes y workflows se trabajarán con **Mastra**.

Mastra se plantea como la capa de orquestación de Dinacode Cortex.

No sería simplemente una librería para llamar a un LLM, sino el runtime donde viven los procesos inteligentes:

```text
ingestar → clasificar → enriquecer → relacionar → depurar → recuperar → actuar
```

### Mastra debería encargarse de:

- definir agentes especializados;
- ejecutar workflows de ingesta;
- orquestar tools;
- conectar con MCPs;
- realizar procesos de curado;
- lanzar loops de mejora;
- preparar contexto para Claude Code o Codex;
- gestionar memoria de agentes;
- evaluar calidad de respuestas o recuperaciones;
- permitir trazabilidad del comportamiento agente.

### Ejemplos de agentes Mastra

#### Ingestion Agent

Recibe nueva información desde una fuente: developer, ticket, PR, Claude Code, etc.

Responsabilidades:

- normalizar entrada;
- identificar proyecto;
- detectar tipo de conocimiento;
- extraer resumen inicial;
- guardar fuente original.

#### Curation Agent

Decide si la información es útil, redundante, incompleta, sensible o contradictoria.

Responsabilidades:

- clasificar utilidad;
- proponer limpieza;
- detectar duplicados;
- marcar información de baja confianza;
- pedir validación humana si procede.

#### Entity Resolution Agent

Relaciona distintas formas de nombrar una misma entidad.

Ejemplos:

- nombres de cliente;
- nombres de proyecto;
- repositorios;
- módulos;
- servicios;
- integraciones;
- personas;
- tecnologías.

#### Knowledge Graph Agent

Crea o actualiza relaciones en el grafo.

Ejemplo:

```text
Cliente → Proyecto → Repositorio → Módulo → Decisión técnica → Incidencia
```

#### Retrieval Agent

Recupera contexto relevante para una pregunta humana o para un agente de desarrollo.

Responsabilidades:

- búsqueda semántica;
- expansión por relaciones del grafo;
- filtrado por permisos;
- priorización por vigencia y confianza;
- generación de respuesta trazable.

#### Context Pack Agent

Genera paquetes de contexto para herramientas como Claude Code o Codex.

Ejemplo de paquete:

- resumen del proyecto;
- decisiones técnicas vigentes;
- restricciones del cliente;
- módulos sensibles;
- convenciones de código;
- incidencias similares;
- riesgos conocidos;
- links a fuentes originales.

---

## 8. Papel de MCP

MCP no se plantea como la inteligencia del sistema, sino como la interfaz estándar y segura para que herramientas externas interactúen con Cortex.

### Objetivo de los MCPs internos

Evitar que cada herramienta acceda directamente a bases de datos, Jira, GitHub, Notion, correo, chats o sistemas internos.

La idea es exponer capacidades controladas:

```text
search_project_context
save_project_context
get_project_summary
get_project_decisions
get_related_incidents
get_client_constraints
create_context_entry
validate_context_entry
get_context_pack
```

### Posibles MCPs corporativos

#### Cortex Knowledge MCP

Operaciones generales sobre la memoria corporativa.

#### Cortex Projects MCP

Consulta y actualización de contexto por proyecto.

#### Cortex Decisions MCP

Gestión de decisiones técnicas.

#### Cortex Search MCP

Búsqueda semántica y relacional.

#### Cortex Context Pack MCP

Generación de contexto para herramientas de desarrollo.

#### Cortex Admin MCP

Operaciones internas de mantenimiento, validación y auditoría.

### Claude Code y Codex

Claude Code podría usar estos MCPs para consultar y guardar contexto.

Codex debería poder usar la misma capa en el futuro si soporta el mecanismo de integración necesario.

El objetivo es que Cortex no dependa de una sola herramienta.

---

## 9. Tecnologías candidatas a estudiar

Esta lista no es una decisión final. Es una base para investigar.

### 9.1. Agentes y workflows

Decisión inicial:

- **Mastra** como framework principal de agentes y workflows.

Alternativas o referencias a comparar:

- LangGraph;
- LangChain;
- LlamaIndex Workflows;
- CrewAI;
- AutoGen;
- Semantic Kernel.

Preguntas a estudiar:

- ¿Mastra cubre bien workflows largos?
- ¿Qué soporte real tiene para MCP?
- ¿Cómo se versionan agentes y tools?
- ¿Cómo se testean agents?
- ¿Cómo se observan ejecuciones?
- ¿Qué tal encaja con TypeScript?
- ¿Qué piezas aporta frente a montar todo ad hoc?

### 9.2. Base vectorial

Opciones:

- Qdrant;
- Weaviate;
- pgvector;
- Pinecone;
- Milvus.

Para demo inicial podrían tener sentido:

- **pgvector**, si se quiere simplicidad y Postgres como centro;
- **Qdrant**, si se quiere una vector DB dedicada y sencilla de levantar en Docker.

Preguntas a estudiar:

- ¿Necesitamos vector DB dedicada desde el principio?
- ¿Basta pgvector para una demo?
- ¿Cómo gestionamos namespaces por proyecto/cliente?
- ¿Cómo versionamos embeddings?
- ¿Cómo reindexamos conocimiento obsoleto?

### 9.3. Grafo de conocimiento

Opciones:

- Neo4j;
- Memgraph;
- ArangoDB;
- Postgres con tablas relacionales;
- grafo lógico propio inicial.

Para demo inicial, quizá no haga falta Neo4j desde el primer día.

Una alternativa simple:

```text
entities
relations
context_entries
context_entry_entities
```

en Postgres.

Preguntas a estudiar:

- ¿Necesitamos grafo real o basta modelo relacional?
- ¿Qué consultas relacionales queremos demostrar?
- ¿Qué entidades mínimas necesitamos?
- ¿Cuándo compensa meter Neo4j/Memgraph?

### 9.4. Base documental / metadatos

Opciones:

- PostgreSQL;
- SQLite para demo local;
- Elasticsearch;
- OpenSearch.

Propuesta razonable para demo:

- PostgreSQL como base principal;
- pgvector o Qdrant para embeddings;
- tablas de metadatos, entidades, relaciones y fuentes.

### 9.5. Modelos LLM

Opciones:

- OpenAI;
- Anthropic;
- Google Gemini;
- modelos locales mediante Ollama, LM Studio o vLLM.

Preguntas:

- ¿Qué modelo clasifica mejor contexto técnico?
- ¿Qué coste tiene enriquecer información automáticamente?
- ¿Qué tareas pueden ir con modelos pequeños?
- ¿Qué tareas necesitan modelos grandes?

### 9.6. Embeddings

Opciones:

- OpenAI embeddings;
- Voyage AI;
- Cohere;
- modelos open source;
- embeddings locales.

Preguntas:

- ¿Qué embeddings funcionan mejor con contexto técnico en español/inglés?
- ¿Cómo gestionamos contenido multilingüe?
- ¿Cómo versionamos embeddings?
- ¿Cómo reindexamos si cambiamos de modelo?

### 9.7. Integraciones de desarrollo

Objetivo inicial:

- Claude Code.

Preparado para:

- Codex;
- ChatGPT;
- IDEs;
- bots internos;
- CLI propia.

Piezas a estudiar:

- configuración de MCPs en Claude Code;
- distribución de MCPs entre developers;
- configuración versionada;
- comandos internos;
- skills;
- prompts corporativos;
- hooks;
- políticas de uso.

---

## 10. LLM Wiki de Karpathy: análisis inicial

Se ha comentado la idea de inspirarse en el concepto informal de una “LLM Wiki” asociado a Andrej Karpathy: una capa de conocimiento más estructurada, mantenible y reescribible por agentes, en lugar de limitarse a almacenar documentos troceados con embeddings.

### Qué aporta conceptualmente

La idea es interesante porque evita pensar en el conocimiento como simples chunks.

Una LLM Wiki se aproximaría más a:

```text
información bruta → hechos → decisiones → conceptos → relaciones → representación mantenible
```

Esto encaja con la necesidad de que el conocimiento sea:

- actualizable;
- reescribible;
- resumible;
- navegable;
- depurable;
- mantenible por agentes;
- útil para humanos y LLMs.

### Por qué puede ser excesivo al inicio

La conclusión preliminar es que una aproximación tipo LLM Wiki puede ser demasiado compleja para una primera demo.

Motivos:

- El problema inicial no es tener una representación perfecta.
- El problema inicial es capturar conocimiento útil.
- Si el volumen de datos no es alto, una LLM Wiki puede sobrediseñar el sistema.
- Requiere criterios claros de edición, consolidación y autoridad.
- Puede derivar en una ontología compleja antes de tener datos reales.
- Puede consumir mucho tiempo sin demostrar valor inmediato.

### Propuesta inicial

No implementar una LLM Wiki completa en la demo.

Sí tomar ideas:

- diferenciar hechos, decisiones, hipótesis y opiniones;
- permitir reescritura y consolidación del conocimiento;
- mantener entradas canónicas por proyecto;
- generar resúmenes vivos;
- conservar fuentes originales;
- versionar conocimiento importante;
- marcar vigencia y confianza.

### Fases propuestas

#### Fase 1

Captura, clasificación, búsqueda y contexto para Claude Code.

#### Fase 2

Enriquecimiento, deduplicación, entidades y relaciones.

#### Fase 3

Evaluar si una representación tipo LLM Wiki aporta valor real.

#### Fase 4

Si tiene sentido, evolucionar hacia páginas canónicas vivas por proyecto, módulo, cliente, decisión o tecnología.

### Conclusión inicial

La hipótesis actual es:

> Para una demo funcional, tiene más sentido construir una memoria híbrida simple —documental, vectorial y relacional— que intentar implementar una LLM Wiki completa desde el principio.

---

## 11. Ejemplos de captura de conocimiento

### 11.1. Captura manual desde developer

Un developer termina una tarea y guarda contexto:

```text
Proyecto: Proyecto A
Área: Autenticación
Tipo: Decisión técnica
Resumen: Se decidió usar OAuth con proveedor externo.
Motivo: El cliente necesita integración con sus cuentas corporativas.
Riesgos: Requiere validar permisos y expiración de tokens.
Fuente: Developer manual
Confianza: Media
Estado: Pendiente de validación
```

Cortex debería:

- normalizar la entrada;
- extraer entidades;
- relacionarla con el proyecto;
- generar embedding;
- crear relación con módulos afectados;
- marcar como decisión técnica;
- guardar fuente y autor;
- dejarla disponible para recuperación.

### 11.2. Captura desde Claude Code

Tras completar una tarea, Claude Code podría generar un resumen:

```text
Resumen de implementación:
- Se modificó el flujo de autenticación.
- Se añadieron validaciones de permisos.
- Se actualizó la gestión de errores.

Archivos relevantes:
- src/auth/service.ts
- src/auth/oauth-client.ts
- src/config/auth.ts

Decisiones tomadas:
- Mantener compatibilidad con el flujo anterior.
- No modificar todavía el módulo legacy.

Pendientes:
- Añadir tests de expiración de token.
- Validar comportamiento en staging.
```

El developer podría revisar y confirmar:

```text
Guardar en Cortex
```

Entonces Claude Code llamaría a un MCP:

```text
save_project_context(...)
```

### 11.3. Captura desde ticket

Al cerrar una tarea:

```text
Ticket: TASK-123
Título: Corregir error en generación de documentos
Estado: Done
PR asociado: #456
```

Cortex podría capturar:

- descripción del ticket;
- comentarios relevantes;
- PR relacionado;
- commits;
- resolución final;
- módulos afectados;
- si hubo workaround;
- si se generó una decisión reutilizable.

### 11.4. Captura desde pull request

Un PR puede contener mucho conocimiento técnico.

Cortex podría extraer:

- qué cambia;
- por qué cambia;
- qué alternativas se comentaron;
- qué riesgos se mencionaron;
- qué comentarios del review son reutilizables;
- qué archivos/módulos quedan relacionados.

### 11.5. Captura desde conversación con cliente

Aunque no sea el foco inicial, puede aportar valor.

Ejemplo:

```text
El cliente indica que no puede usar servicios cloud públicos por política interna.
```

Cortex debería guardar algo como:

```text
Tipo: Restricción de cliente
Contenido: El proyecto debe desplegarse en infraestructura propia.
Fuente: Reunión / correo / chat
Confianza: Media o alta según origen
Estado: Pendiente o validado
```

---

## 12. Loops automáticos de mejora del conocimiento

Una parte clave de Dinacode Cortex es que el conocimiento no se limite a entrar en el sistema, sino que pueda mejorar con el tiempo mediante procesos automáticos de revisión, limpieza y consolidación.

La idea es que Cortex no sea una base de datos pasiva, sino una memoria viva que se depura conforme la empresa trabaja.

### 12.1. Loop de deduplicación

Cuando entra nuevo conocimiento, Cortex puede comprobar si ya existe información parecida.

Ejemplo:

```text
Nueva entrada:
"El cliente no permite utilizar servicios cloud públicos."

Conocimiento existente:
"Las soluciones deben desplegarse en infraestructura propia."
"El uso de proveedores cloud externos está restringido."
```

Acción sugerida:

```text
Posible duplicado detectado.
Consolidar estas entradas como una única restricción del cliente.
```

Objetivo:

- evitar conocimiento repetido;
- agrupar información equivalente;
- mantener una fuente más clara y consultable.

### 12.2. Loop de obsolescencia

Cortex puede revisar periódicamente información antigua para detectar si sigue siendo válida.

Ejemplo:

```text
Decisión antigua:
"Se utiliza una versión específica del framework por limitaciones de infraestructura."

Nueva información:
"La infraestructura ha sido actualizada y ya no existe dicha limitación."
```

Acción:

```text
Estado: posiblemente obsoleta
Motivo: la restricción técnica original ya no existe.
```

Objetivo:

- evitar respuestas basadas en información caducada;
- diferenciar conocimiento histórico y vigente;
- pedir validación humana cuando haya dudas.

### 12.3. Loop de enriquecimiento

Cuando se guarda una entrada simple, Cortex puede ampliarla automáticamente con contexto relacionado.

Ejemplo:

```text
Entrada original:
"Se decidió utilizar procesamiento asíncrono para esta funcionalidad."
```

Enriquecimiento:

```text
Proyecto relacionado
Tecnologías implicadas
Área funcional afectada
Dependencias relacionadas
Posibles riesgos detectados
```

Objetivo:

- añadir metadatos útiles;
- mejorar recuperación futura;
- relacionar información con proyectos, tecnologías y decisiones.

### 12.4. Loop de resolución de entidades

Cortex puede detectar que distintas formas de escribir algo hacen referencia a la misma entidad.

Ejemplo:

```text
"Portal Cliente"
"Portal del Cliente"
"Frontend Cliente"
"Aplicación Web Cliente"
```

Consolidación:

```text
Entidad canónica: Portal Cliente
```

Objetivo:

- evitar fragmentación;
- mejorar búsquedas;
- construir un grafo más limpio.

### 12.5. Loop de contradicciones

Cortex puede detectar información incompatible.

Ejemplo:

```text
Entrada A:
"El cliente exige despliegue en infraestructura propia."

Entrada B:
"La solución se desplegará en un proveedor cloud externo."
```

Acción:

```text
Contradicción detectada.
Restricción de infraestructura incompatible con estrategia de despliegue.
Requiere revisión humana.
```

Objetivo:

- detectar conflictos antes de que generen errores;
- convertir conocimiento disperso en señales útiles;
- mejorar la calidad de decisiones técnicas.

### 12.6. Loop de baja confianza

No todo el conocimiento tiene la misma calidad.

Ejemplo:

```text
Alta confianza:
- ticket aprobado;
- PR fusionada;
- documento validado.

Media confianza:
- resumen de reunión;
- comentario de developer.

Baja confianza:
- transcripción automática;
- inferencia generada por IA.
```

Acción:

```text
Esta información parece relevante, pero procede de una fuente de baja confianza.
¿Desea validarla y convertirla en conocimiento oficial?
```

### 12.7. Loop de consolidación por proyecto

Cortex podría generar periódicamente una vista consolidada:

```text
Proyecto:
- arquitectura actual;
- decisiones técnicas principales;
- restricciones activas;
- incidencias recurrentes;
- personas clave;
- riesgos detectados;
- deuda técnica conocida.
```

### 12.8. Loop de aprendizaje desde consultas

Si muchos developers preguntan lo mismo, Cortex detecta una laguna.

Ejemplo:

```text
Pregunta frecuente:
"¿Dónde se configura el sistema de autenticación?"
```

Acción:

```text
Crear o mejorar una entrada de conocimiento sobre autenticación.
```

### 12.9. Loop de limpieza de ruido

Cortex debería ignorar o degradar contenido de bajo valor:

```text
"Ok."
"Perfecto."
"Lo reviso mañana."
"Lo vemos luego."
```

Objetivo:

- reducir ruido;
- reducir costes;
- mejorar precisión de recuperación.

### 12.10. Loop de generación de contexto para agentes

Antes de que Claude Code o Codex trabajen sobre un proyecto, Cortex puede preparar un paquete:

```text
Context Pack:
- resumen del proyecto;
- decisiones técnicas recientes;
- restricciones activas;
- módulos sensibles;
- incidencias similares;
- convenciones internas;
- fuentes relevantes.
```

---

## 13. Gestión centralizada de Claude Code, MCPs y skills

Otro bloque importante del proyecto es cómo distribuir configuración y herramientas IA entre todos los compañeros.

El objetivo es evitar que cada developer tenga una configuración distinta, desactualizada o insegura.

### Problema

Cada developer podría necesitar:

- configuración de MCPs;
- prompts corporativos;
- skills;
- comandos;
- instrucciones de proyecto;
- políticas de seguridad;
- accesos por rol;
- configuración para Claude Code;
- preparación futura para Codex.

Si se configura manualmente en cada máquina, aparecerán problemas:

- versiones distintas;
- errores de configuración;
- MCPs inseguros;
- prompts antiguos;
- pérdida de control;
- dificultad para actualizar.

### Propuesta inicial

Crear un repositorio o registry interno de configuración IA.

Ejemplo:

```text
company-ai-config/
  claude-code/
    CLAUDE.md
    commands/
    hooks/
    mcp-config.json
  codex/
    config/
    instructions/
  mcps/
    cortex-knowledge/
    cortex-projects/
    cortex-search/
  skills/
    laravel-developer/
    symfony-developer/
    ios-developer/
    code-reviewer/
  prompts/
    project-analysis.md
    decision-record.md
    onboarding-context.md
  policies/
    security.md
    data-access.md
    client-confidentiality.md
```

### Comando de sincronización futuro

Una idea sería crear una CLI interna:

```bash
cortex sync
```

Que sincronice:

- MCPs permitidos;
- skills;
- prompts;
- reglas internas;
- configuración de Claude Code;
- configuración preparada para Codex;
- credenciales o referencias seguras;
- versiones compatibles.

### Preguntas abiertas

- ¿Basta un repositorio Git inicialmente?
- ¿Hace falta una CLI propia?
- ¿Cómo gestionamos permisos por developer/proyecto?
- ¿Cómo se actualizan MCPs sin romper entornos?
- ¿Cómo se audita qué configuración usa cada persona?
- ¿Cómo se soporta Claude Code hoy y Codex mañana?

---

## 14. Modelo de datos inicial hipotético

Este modelo es una propuesta mínima para una demo. Debe cuestionarse.

### context_entries

Representa una unidad de conocimiento.

Campos posibles:

```text
id
project_id
client_id
title
content
summary
type
status
confidence
validity
source_type
source_reference
created_by
created_at
updated_at
superseded_by
metadata
```

Tipos posibles:

```text
decision
constraint
incident
architecture
module_note
technical_debt
convention
business_rule
integration_note
risk
how_to
meeting_summary
pr_summary
ticket_resolution
```

Estados posibles:

```text
draft
pending_validation
validated
rejected
obsolete
superseded
```

Niveles de confianza:

```text
low
medium
high
verified
```

### entities

Representa entidades relevantes.

```text
id
name
canonical_name
type
metadata
created_at
updated_at
```

Tipos:

```text
client
project
repository
module
service
technology
person
integration
decision
incident
vendor
```

### relations

Representa relaciones entre entidades o entradas.

```text
id
source_id
source_type
target_id
target_type
relation_type
confidence
metadata
created_at
```

Tipos de relación:

```text
belongs_to
affects
depends_on
contradicts
supersedes
related_to
implemented_by
discussed_in
caused_by
resolved_by
```

### sources

Representa fuente original.

```text
id
source_type
external_id
url
raw_content
metadata
created_at
```

Tipos:

```text
manual
claude_code
github_pr
github_issue
jira_ticket
notion_doc
email
chat
meeting_transcript
codex
```

### embeddings

```text
id
context_entry_id
embedding_model
embedding_version
vector
chunk_index
created_at
```

---

## 15. Demo funcional propuesta

La demo debería ser pequeña pero mostrar el sistema completo.

### 15.1. Escenario de demo

Crear un proyecto ficticio:

```text
Proyecto Demo: Acme Portal
Cliente Demo: Acme Corp
Stack: Laravel + Vue + PostgreSQL
```

El proyecto tiene:

- una arquitectura concreta;
- decisiones técnicas;
- restricciones de cliente;
- incidencias antiguas;
- un módulo sensible;
- varias entradas de conocimiento;
- uno o dos tickets simulados;
- uno o dos PRs simulados;
- documentación mínima.

### 15.2. Flujo 1: guardar contexto manual

Un developer guarda una decisión:

```text
Se decidió mantener el módulo legacy de facturación porque el cliente depende de una integración externa que todavía no puede migrarse.
```

Cortex:

- clasifica como decisión técnica;
- identifica módulo legacy;
- relaciona con proyecto;
- genera embedding;
- guarda en Postgres;
- crea relación con entidad `facturación`;
- marca como pendiente de validación o validada.

### 15.3. Flujo 2: captura desde Claude Code

Claude Code termina una tarea y llama al MCP:

```text
save_project_context
```

Contenido:

- resumen de cambios;
- archivos modificados;
- decisiones;
- riesgos;
- pendientes.

Cortex:

- procesa mediante Mastra;
- extrae entidades;
- guarda entrada;
- genera context pack actualizado.

### 15.4. Flujo 3: consulta desde Claude Code

El developer pide:

```text
Antes de modificar el módulo de facturación, consulta Cortex y dime qué debo tener en cuenta.
```

Claude Code llama:

```text
get_context_pack(project="Acme Portal", area="facturación")
```

Cortex responde:

```text
Contexto relevante:
- El módulo tiene integración externa legacy.
- No debe romper compatibilidad con proceso antiguo.
- Hay una decisión técnica validada sobre no migrarlo todavía.
- Existe una incidencia previa relacionada con generación de documentos.
- Archivos sensibles: ...
- Recomendación: revisar fuentes X, Y, Z antes de modificar.
```

### 15.5. Flujo 4: loop de mejora

Se introduce una nueva entrada contradictoria:

```text
Se va a eliminar el módulo legacy de facturación en la próxima release.
```

Cortex detecta contradicción con decisión previa:

```text
Contradicción detectada:
Existe una decisión vigente que indica que el módulo legacy no debe migrarse todavía.
```

Solicita validación.

### 15.6. Flujo 5: consulta semántica y relacional

Pregunta:

```text
¿Tenemos problemas parecidos en otros proyectos con módulos legacy?
```

Cortex combina:

- búsqueda vectorial;
- relaciones por entidades;
- filtros por permisos;
- resumen generado por agente.

---

## 16. Bloques mínimos de la demo

### Backend Cortex

- API básica;
- Postgres;
- modelo de context entries;
- modelo de entities;
- modelo de relations;
- almacenamiento de fuentes;
- integración con embeddings.

### Mastra

- Agent de ingesta;
- Agent de clasificación;
- Agent de retrieval;
- Workflow de captura;
- Workflow de context pack;
- Workflow de mejora/deduplicación básico.

### MCP Server

Herramientas mínimas:

```text
save_project_context
search_project_context
get_project_context_pack
list_project_decisions
validate_context_entry
```

### Claude Code

Configuración para consumir el MCP.

Ejemplo de uso:

```text
Consulta Cortex antes de tocar este módulo.
```

### Preparación Codex

No hace falta integrarlo en la demo inicial si no está claro, pero sí diseñar la interfaz de manera neutral:

```text
MCP / API estable
```

para que Codex pueda consumir lo mismo después.

### UI opcional

Una UI mínima podría ayudar mucho en la demo:

- lista de entradas;
- detalle con fuente;
- entidades relacionadas;
- estado de validación;
- contradicciones;
- context pack generado.

No es imprescindible, pero visualmente ayuda.

---

## 17. Ejemplo de estructura técnica de repositorios

Opción monorepo:

```text
dinacode-cortex/
  apps/
    api/
    web/
    mcp-server/
  packages/
    agents/
    workflows/
    shared/
    database/
    embeddings/
  config/
    claude-code/
    codex/
    prompts/
    skills/
  docs/
    architecture.md
    demo-script.md
    decisions.md
  docker-compose.yml
```

Opción separada:

```text
cortex-api
cortex-mcp
cortex-agents
cortex-config
cortex-demo-project
```

Para demo, probablemente sea más cómodo monorepo.

---

## 18. Preguntas críticas antes de implementar

Cada una de estas preguntas debe debatirse antes de convertir la demo en producto.

### Producto

- ¿Quién es el usuario principal: developer, tech lead, project manager o agente IA?
- ¿Qué consulta concreta debe resolver mejor que una wiki?
- ¿Qué fricción máxima aceptamos al guardar contexto?
- ¿Cómo evitamos que se convierta en otra herramienta que nadie alimenta?

### Datos

- ¿Qué fuentes entran en la fase 1?
- ¿Qué fuentes quedan fuera inicialmente?
- ¿Qué datos no deberíamos almacenar nunca?
- ¿Cómo anonimizamos o protegemos datos sensibles?
- ¿Qué permisos aplican por cliente/proyecto?

### Arquitectura

- ¿Postgres + pgvector basta para empezar?
- ¿Qdrant aporta ventajas reales?
- ¿Necesitamos Neo4j desde el inicio?
- ¿Cómo versionamos conocimiento?
- ¿Cómo representamos obsolescencia?

### Agentes

- ¿Qué decisiones puede tomar un agente automáticamente?
- ¿Qué decisiones requieren validación humana?
- ¿Cómo evaluamos si un agente clasifica bien?
- ¿Qué logs y trazas necesitamos?
- ¿Cómo evitamos que una inferencia se convierta en hecho?

### MCPs

- ¿Qué herramientas MCP son mínimas?
- ¿Cómo autenticamos a cada developer?
- ¿Cómo auditamos accesos?
- ¿Cómo limitamos contexto por proyecto/cliente?
- ¿Cómo exponemos lo mismo a Claude Code y Codex?

### Configuración corporativa

- ¿Usamos Git como fuente inicial de configuración?
- ¿Creamos CLI propia?
- ¿Cómo distribuimos cambios?
- ¿Cómo gestionamos versiones?
- ¿Cómo damos rollback si una configuración rompe Claude Code?

---

## 19. Riesgos identificados

### Riesgo 1: Sobrediseñar demasiado pronto

Meter desde el inicio LLM Wiki, Neo4j complejo, múltiples fuentes, UI avanzada y workflows sofisticados puede frenar la demo.

Mitigación:

- demo pequeña;
- pocos flujos;
- datos ficticios;
- arquitectura extensible pero simple.

### Riesgo 2: Capturar mucho ruido

Si se ingieren chats, correos y reuniones sin filtro, el sistema puede llenarse de información irrelevante.

Mitigación:

- foco inicial en contexto de proyecto;
- clasificación de utilidad;
- niveles de confianza;
- limpieza automática.

### Riesgo 3: Confundir inferencias con hechos

Los agentes pueden generar conclusiones incorrectas.

Mitigación:

- separar hechos, hipótesis, decisiones y opiniones;
- mantener fuente original;
- marcar confianza;
- validación humana.

### Riesgo 4: Mala adopción por developers

Si guardar contexto cuesta demasiado, nadie lo hará.

Mitigación:

- integración con Claude Code;
- prompts sencillos;
- captura automática tras tareas;
- validación rápida;
- valor inmediato en consultas.

### Riesgo 5: Seguridad y confidencialidad

El sistema puede contener información sensible de clientes.

Mitigación:

- permisos por proyecto;
- MCPs internos securizados;
- auditoría;
- filtros;
- políticas claras;
- evitar fuentes sensibles en demo inicial.

---

## 20. Roadmap propuesto para demo

### Paso 1: Definir alcance mínimo

- Proyecto ficticio.
- 10-20 entradas de contexto.
- 3-5 entidades.
- 3 flujos principales.

### Paso 2: Montar almacenamiento base

- Postgres.
- Tablas de context entries.
- Tablas de entities/relations.
- Embeddings con pgvector o Qdrant.

### Paso 3: Crear agentes Mastra

- Ingestion Agent.
- Classification Agent.
- Retrieval Agent.
- Context Pack Agent.

### Paso 4: Crear workflows Mastra

- `captureContextWorkflow`.
- `generateContextPackWorkflow`.
- `detectDuplicateOrContradictionWorkflow`.

### Paso 5: Crear MCP Server

Tools mínimas:

- `save_project_context`;
- `search_project_context`;
- `get_project_context_pack`;
- `list_project_decisions`;
- `validate_context_entry`.

### Paso 6: Integrar Claude Code

- Configurar MCP.
- Crear instrucciones de uso.
- Preparar demo con comandos naturales.

### Paso 7: Preparar compatibilidad conceptual con Codex

- Mantener tools neutras.
- Documentar API/MCP.
- Evitar dependencias exclusivas de Claude Code.

### Paso 8: Crear script de demo

Secuencia:

1. Mostrar problema.
2. Guardar contexto.
3. Consultar contexto desde Claude Code.
4. Detectar contradicción.
5. Generar context pack.
6. Mostrar cómo Codex podría consumir lo mismo.

### Paso 9: Preparar presentación técnica

Estructura sugerida:

1. El problema del contexto en consultoría software.
2. Qué es Dinacode Cortex.
3. Arquitectura.
4. Mastra como runtime de agentes.
5. MCPs como interfaz segura.
6. Memoria híbrida: documental + vectorial + relacional.
7. Demo.
8. Lecciones aprendidas.
9. Futuras líneas.

---

## 21. Qué debería demostrar la demo

La demo debería demostrar cinco ideas:

### 1. El conocimiento entra con poca fricción

El developer no debe escribir documentación larga.

### 2. Mastra orquesta agentes reales

No es solo una llamada a un modelo.

### 3. MCP permite conectar Claude Code sin acoplarlo todo

La herramienta de IA consume una interfaz estándar.

### 4. El sistema recupera contexto útil

No solo devuelve documentos parecidos.

### 5. Cortex mejora el conocimiento

Detecta duplicados, contradicciones, obsolescencia o baja confianza.

---

## 22. Conclusión

Dinacode Cortex debe plantearse como una plataforma de memoria corporativa para proyectos software.

La clave no es construir una base vectorial ni una wiki con IA. La clave es reducir la pérdida de contexto organizativo en proyectos complejos.

La demo funcional debería ser suficientemente pequeña para construirse rápido, pero suficientemente completa para demostrar todos los bloques:

- captura;
- agentes Mastra;
- workflows;
- almacenamiento híbrido;
- MCP corporativo;
- consulta desde Claude Code;
- preparación para Codex;
- loops de mejora del conocimiento.

Todo lo descrito debe validarse. La arquitectura propuesta no debe tratarse como definitiva, sino como un punto de partida para estudiar, debatir, prototipar y medir qué aporta valor real.

