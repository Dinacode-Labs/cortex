# Changelog

Cambios notables de Cortex. Formato: [Keep a Changelog](https://keepachangelog.com/es/1.1.0/);
versionado [SemVer](https://semver.org/lang/es/).

Mientras estemos en `0.x`, una versión **menor** puede traer cambios incompatibles y una
**patch** solo arregla cosas.

## [Unreleased]

### Added
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

### Changed
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
