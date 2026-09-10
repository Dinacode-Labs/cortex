# syntax=docker/dockerfile:1.7
# Imagen única para todos los servicios de Cortex (server / web / mcp / worker / migrate).
# Cada uno se distingue por su comando; el default es la API.
#
# Tres etapas por dos razones concretas: que las dependencias no se reinstalen cuando solo
# cambia el código (se copian antes los package.json y nada más), y que la imagen final no
# lleve ni las devDependencies ni las fuentes TypeScript.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /app

# --- deps: solo los manifiestos, para aprovechar la caché de capas --------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json     packages/shared/
COPY packages/client/package.json     packages/client/
COPY packages/database/package.json   packages/database/
COPY packages/embeddings/package.json packages/embeddings/
COPY packages/core/package.json       packages/core/
COPY packages/agents/package.json     packages/agents/
COPY apps/server/package.json         apps/server/
COPY apps/web/package.json            apps/web/
COPY apps/mcp-server/package.json     apps/mcp-server/
COPY apps/admin/package.json          apps/admin/
COPY apps/cli/package.json            apps/cli/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# --- build: compila y se queda solo con lo que hace falta para ejecutar ---------------
FROM deps AS build
COPY tsconfig.base.json tsconfig.build.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm build
# Fuera devDependencies, fuentes y artefactos de compilación: en producción no se
# transpila nada, y cada MB que sobra es un MB que hay que auditar.
#
# `pnpm prune --prod` NO sirve aquí: en un workspace se lleva por delante también los enlaces
# entre paquetes internos, y la imagen arranca con "Cannot find package '@cortex/shared'".
# Reinstalar sin devDependencies los reconstruye.
RUN rm -rf node_modules packages/*/node_modules apps/*/node_modules
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --prod --frozen-lockfile --ignore-scripts
RUN find /app/packages /app/apps -type d -name src -prune -exec rm -rf {} + \
 && find /app -name "*.tsbuildinfo" -delete

# --- runtime -------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
# Ficheros de datos que las apps resuelven en ejecución (el instalador que sirve el server).
COPY --chown=node:node scripts/install.sh /app/scripts/install.sh
COPY --chown=node:node config/toolbelt.json /app/config/toolbelt.json
USER node
EXPOSE 8787 8080 8788

# El puerto se ajusta por servicio (HEALTH_PORT) porque la imagen es la misma para los tres.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||'8787')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
