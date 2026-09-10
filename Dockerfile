# Imagen única para todos los servicios de Cortex (server / web / mcp-http / worker).
# El comando lo fija docker-compose por servicio; el default es la API.
#
# Compila con `tsc -b` y ejecuta `dist/`, no las fuentes con tsx: arrancar más rápido, sin
# transpilar en caliente, y con los errores de tipos detectados en build y no en producción.
# El multi-stage (deps sin devDependencies en la imagen final) llega con el PR de deploy.
FROM node:22-slim

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# server · web · mcp-http
EXPOSE 8787 8080 8788

CMD ["node", "apps/server/dist/index.js"]
