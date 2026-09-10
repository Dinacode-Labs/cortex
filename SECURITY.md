# Política de seguridad

## Reportar una vulnerabilidad

**No abras un issue público.** Usa una de estas dos vías:

- **GitHub Security Advisories** (preferida): pestaña *Security* → *Report a vulnerability*.
- **Email**: `security@dinacode.com`.

Incluye qué versión, cómo reproducirlo y qué impacto crees que tiene. Respondemos en
**5 días laborables** con una primera valoración, y te mantenemos al día hasta el cierre.
Si el reporte es válido, acreditamos a quien lo envió en las notas de la versión, salvo que
prefiera lo contrario.

## Versiones soportadas

Solo la **última versión menor publicada**. Cortex está en `0.x`: mientras dure, una versión
menor puede traer cambios incompatibles y no se hacen backports de seguridad a versiones
anteriores.

## Alcance

Entra dentro del alcance el código de este repositorio: la API HTTP (`apps/server`), la UI
web (`apps/web`), el servidor MCP (`apps/mcp-server`), el CLI y los paquetes de
`packages/`. Nos interesan especialmente:

- Saltarse el control de acceso a un proyecto (leer o escribir en uno ajeno).
- Fugas entre proyectos en búsqueda, `ask`, context pack o grafo.
- Problemas en el flujo de login por OTP (fuerza bruta, reutilización de códigos, fijación).
- Inyección (SQL, XSS en la UI SSR) o ejecución de código.
- Fuga de secretos: credenciales que acaben persistidas, enviadas al proveedor de LLM o
  escritas en logs.

Queda fuera lo que dependa de cómo se despliegue: una instancia sin TLS, sin
`CORTEX_AUTH_DOMAIN` o con el proveedor de email en modo `log` **en producción** son
configuraciones inseguras, no fallos del código. Aun así, el servidor avisa de esas tres
cosas al arrancar.

## Cómo tratamos los secretos

- Nunca en el repositorio. `.env` está ignorado; `.env.example` es la plantilla.
- Hay un borrado de secretos (`scrub`, en `@cortex/shared`) que se aplica **dos veces**:
  antes de mandar nada al modelo de lenguaje y antes de persistir. El servidor no confía en
  que el cliente haya limpiado. Es un filtro de última línea, no una garantía: si crees que
  se le escapa un patrón habitual, repórtalo.
- Las credenciales del CLI viven en `~/.cortex/credentials` con permisos `600`.

## Dependencias

`pnpm audit` corre en cada CI de forma **informativa, no bloqueante**, y Dependabot abre PRs
semanales. La razón de que no bloquee: hoy hay vulnerabilidades altas **transitivas** en
`mammoth`, `@modelcontextprotocol/sdk` y `@mastra/core` que no podemos arreglar hasta que
esos proyectos publiquen. Un gate que falla desde el primer día se acaba desactivando y deja
de aportar nada; preferimos verlo en cada build y actualizar en cuanto haya versión.

`xlsx` se instala desde el CDN oficial de SheetJS (`cdn.sheetjs.com`) y no desde npm, porque
la versión de npm está abandonada y arrastra CVE-2023-30533 y CVE-2024-22363 sin corregir.
Dependabot **no sigue** tarballs por URL: hay que revisarlo a mano cada trimestre.

## Nota sobre el historial

El historial de este repositorio anterior a su apertura **no se publica**. Si Cortex se
publica como open source, será desde una instantánea limpia (ver ADR-0026).
