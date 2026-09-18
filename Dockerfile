# syntax=docker/dockerfile:1.7
# A single image for every Cortex service (server / web / mcp / worker / migrate). Each one
# is told apart by its command; the default is the API.
#
# Three stages for two concrete reasons: so dependencies are not reinstalled when only the
# code changes (the package.json files are copied first, and nothing else), and so the final
# image carries neither the devDependencies nor the TypeScript sources.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /app

# --- deps: manifests only, to make the layer cache work -------------------------------
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

# --- build: compile and keep only what is needed to run -------------------------------
FROM deps AS build
COPY tsconfig.base.json tsconfig.build.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm build
# Out go the devDependencies, the sources and the build artefacts: nothing is transpiled in
# production, and every spare MB is an MB somebody has to audit.
#
# `pnpm prune --prod` does NOT work here: in a workspace it also takes the links between
# internal packages with it, and the image starts up with "Cannot find package
# '@cortex/shared'". Reinstalling without devDependencies rebuilds them.
RUN rm -rf node_modules packages/*/node_modules apps/*/node_modules
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --prod --frozen-lockfile --ignore-scripts
RUN find /app/packages /app/apps -type d -name src -prune -exec rm -rf {} + \
 && find /app -name "*.tsbuildinfo" -delete

# --- runtime -------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
# Data files the apps resolve at runtime (the installer the server hands out).
COPY --chown=node:node scripts/install.sh /app/scripts/install.sh
COPY --chown=node:node config/toolbelt.json /app/config/toolbelt.json
USER node
EXPOSE 8787 8080 8788

# The port is set per service (HEALTH_PORT) because the image is the same for all three.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||'8787')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
