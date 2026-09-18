---
paths:
  - "packages/agents/**/*.ts"
---

# Capa LLM

`agents` es la única capa que habla con un modelo, y `core` no la importa nunca: implementa los
hooks que `core` declara y los cablea en `wire.ts` (ver `arquitectura.md`).

- **Rol nuevo** = `AgentRole` + `INSTRUCTIONS` + registro en `mastra.ts`, y en `JSON_ROLES` si
  devuelve JSON. Las instrucciones van **en español**, porque el corpus que procesan lo es.
- Cada rol puede tener su modelo (`CORTEX_MODEL_<ROL>`, ADR-0023): barato para lo mecánico,
  potente para el juicio. Mismo endpoint OpenAI-compatible; solo cambia el id.
- **Todo lo que sale hacia el modelo pasa antes por `scrub()`.**
- Lo que el modelo devuelve es una **inferencia**, no un hecho: entra con confianza baja y con su
  fuente. La trazabilidad es innegociable — fuente, fecha, autor, confianza, estado y vigencia.
- Un fallo del modelo **degrada**, no rompe: `core` tiene heurística para todo lo que aquí se
  enriquece, y sin `LLM_PROVIDER` el producto entero sigue funcionando.
- `agents` usa **zod v4** (lo exige Mastra), aislado del v3 del resto del repo. No cruces schemas.
- El consumo se mide (`recordUsage`): lo que cuesta la inteligencia se ve, no se intuye.
