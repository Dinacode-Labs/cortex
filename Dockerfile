# Imagen única para todos los servicios de Cortex (server / web / mcp-http / worker).
# Ejecuta con tsx (sin paso de build). El comando lo fija docker-compose por servicio.
FROM node:22-slim

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# server · web · mcp-http
EXPOSE 8787 8080 8788

CMD ["pnpm", "--filter", "@cortex/server", "start"]
