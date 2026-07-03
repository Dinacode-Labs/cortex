# Auditoría integral de Dinacode Cortex (junio 2026)

Auditoría de mejora integral sobre `main`: código, datos, seguridad, calidad de memoria
frente al estado del arte, cumplimiento del plan fundacional, investigación, operación y DX.
Realizada con un workflow multiagente (mapear 10 subsistemas → auditar 8 dimensiones →
**verificar adversarialmente** los hallazgos críticos/altos → sintetizar). 90 hallazgos,
26 críticos/altos verificados contra el código.

> **Empieza por el [resumen ejecutivo](./00-resumen-ejecutivo.md)** (veredicto, scorecard,
> top 10, 5 apuestas) y el [backlog priorizado](./99-backlog-priorizado.md) (qué hacer y en
> qué orden).

## Documentos

| # | Documento | Estado |
|---|-----------|--------|
| 00 | [Resumen ejecutivo](./00-resumen-ejecutivo.md) | — |
| 01 | [Arquitectura, estabilidad y robustez](./01-arquitectura.md) | 🟡 |
| 02 | [Seguridad y autenticación](./02-seguridad.md) | 🔴 |
| 03 | [Modelo de datos y correctitud](./03-datos.md) | 🟡 |
| 04 | [Calidad de memoria y retrieval vs SOTA](./04-memoria-sota.md) | 🟡 |
| 05 | [Cobertura de requisitos vs el plan fundacional](./05-requisitos.md) | 🟡 |
| 06 | [Solidez de la investigación](./06-investigacion.md) | 🟡 |
| 07 | [Tests, observabilidad, operación y producción](./07-ops.md) | 🟡 |
| 08 | [DX, onboarding y documentación](./08-dx.md) | 🟢 |
| 09 | [Modelos y costes (benchmarks + OpenRouter)](./09-modelos-y-costes.md) | — |
| 99 | [Backlog priorizado de hallazgos](./99-backlog-priorizado.md) | — |

## Cómo leerla

Severidad: 🔴 crítica/alta · 🟡 media · 🟢 baja / bien hecho. Cada hallazgo lleva evidencia
`file:line`, impacto, recomendación y esfuerzo (S/M/L). El producto es un **PoC interno**
("hipótesis a validar") y las severidades se calibran en consecuencia.

> Estos documentos son una **foto a junio de 2026**. Al corregir un hallazgo, anótalo en el
> backlog o en `docs/decisions.md`; el código manda sobre la auditoría.

> **Complemento (julio 2026):** la [revisión de arquitectura y plan de refactor](../refactor/README.md)
> audita la *estructura del código* (god-files, duplicación, capas, entrypoints) de cara al
> refactor por fases; donde coincide con esta auditoría referencia los números del backlog.
