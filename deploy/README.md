# Desplegar Cortex

Un solo host con Docker. Caddy delante (TLS automático), y detrás la API, la UI, el MCP,
Postgres, un worker de mantenimiento y copias de seguridad diarias.

```
https://<dominio>/            → UI web
https://<dominio>/api/*       → API (Caddy recorta el prefijo)
https://<dominio>/mcp         → MCP por HTTP
https://<dominio>/install.sh  → instalador del CLI
```

Solo Caddy publica puertos. Postgres no se asoma a internet.

## Requisitos

- Docker ≥ 24 con Compose v2.
- Un dominio apuntando al host (registro A/AAAA) y los puertos 80 y 443 abiertos. Caddy
  necesita el 80 para validar el certificado, no solo el 443.
- Acceso a la imagen: `docker login ghcr.io` si el paquete es privado.

## Primer despliegue

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env          # lleva la contraseña de Postgres y las claves del proveedor
$EDITOR deploy/.env            # dominio, contraseñas, email, proveedores

docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps      # todo debe salir healthy
```

Comprueba que responde:

```bash
curl -s https://<dominio>/api/health     # {"ok":true,"service":"cortex-server","db":"ok"}
curl -s https://<dominio>/health         # la UI
curl -si https://<dominio>/mcp | head -1 # 401: está vivo y pidiendo autenticación
```

Y desde el portátil de alguien:

```bash
curl -fsSL https://<dominio>/install.sh | sh
cortex link --create "Mi Proyecto"
cortex doctor
```

Lo que hay que revisar antes de dar por bueno el despliegue:

- `CORTEX_AUTH_DOMAIN` no está vacío. Vacío significa que cualquier email del mundo puede
  registrarse. El servidor lo avisa al arrancar; búscalo en los logs.
- `CORTEX_EMAIL_PROVIDER` no es `log`. Con `log` el código de acceso solo se imprime en los
  logs del servidor y nadie puede entrar.
- `CORTEX_VERSION` es una versión concreta, no `latest`. Con `latest`, un reinicio puede
  cambiar de versión sin que nadie lo haya decidido.

## Actualizar

```bash
$EDITOR deploy/.env    # CORTEX_VERSION=0.2.0
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
```

Las migraciones se aplican solas: el servicio `migrate` corre antes que los demás y estos
esperan a que termine bien.

**Volver atrás no es simétrico.** Las migraciones solo van hacia delante, así que bajar la
versión de la imagen funciona mientras la versión nueva no haya migrado el esquema. Si migró,
hay que restaurar la copia anterior. Por eso conviene una copia manual antes de una
actualización grande: `./deploy/backup-now.sh`.

## Copias de seguridad

Diarias y automáticas, con retención de 7 días, 4 semanas y 6 meses, en el volumen
`cortex-deploy_cortex-backups`.

```bash
./deploy/backup-now.sh     # una copia ahora mismo
docker compose -f deploy/docker-compose.yml cp backup:/backups ./backups-copia
```

**Sácalas del host.** Una copia que vive en la misma máquina que la base de datos no protege
del caso que más importa, que es perder la máquina.

## Restaurar

```bash
./deploy/restore.sh <backup.sql.gz>                                # reemplaza la base real
./deploy/restore.sh <backup.sql.gz> --target-db cortex_prueba      # simulacro, sin tocar nada
```

**Haz el simulacro todos los meses.** Una copia que nunca se ha restaurado no es una copia,
es un fichero. El simulacro restaura a una base aparte y cuenta las entradas.

## Rotar credenciales

- **Claves de LLM, embeddings y SMTP**: cámbialas en `deploy/.env` y
  `docker compose -f deploy/docker-compose.yml up -d`. No hace falta migrar nada.
- **Contraseña de Postgres**: cámbiala primero en la base
  (`ALTER USER cortex WITH PASSWORD '…'`), y después en `POSTGRES_PASSWORD` y en
  `DATABASE_URL`, que tienen que coincidir. Si solo cambias el `.env`, los servicios dejan de
  conectar.
- **Tokens de usuario**: se invalidan todos borrando la tabla de sesiones. Es lo que hay que
  hacer si se filtra un token o se va alguien del equipo.

## Logs

```bash
docker compose -f deploy/docker-compose.yml logs -f server
docker compose -f deploy/docker-compose.yml logs -f caddy   # certificados y peticiones
```

## Seguridad

- Solo Caddy publica puertos; Postgres y las apps viven en la red interna.
- Con `NODE_ENV=production` la cookie de sesión es `secure`, así que la UI **solo** funciona
  por HTTPS.
- Cabeceras de seguridad puestas por las tres apps, y HSTS por Caddy.
- Los contenedores corren como usuario `node`, no como root.
- `deploy/.env` lleva secretos: `chmod 600` y nunca al repositorio.

## Desarrollo

Esto es el despliegue. Para trabajar en el código, `pnpm db:up` levanta solo Postgres en el
puerto 5433 y todo lo demás corre en local. Los dos composes están aislados a propósito: sus
volúmenes no se tocan, y un `down -v` en uno no se lleva los datos del otro.
