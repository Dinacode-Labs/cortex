import type { Context } from "hono";
import { getEnvNum } from "@cortex/shared";

/**
 * Límite por IP para el envío de códigos de acceso.
 *
 * `requestOtp` ya limita **por dirección de correo**, que impide machacar a una persona. Lo que
 * no impedía es que desde una sola IP se pidan códigos para muchas direcciones distintas: cada
 * una estrena su propio cupo. Con el envío de correo activo eso son mensajes de verdad a gente
 * de verdad, y una factura.
 *
 * Es una medida acotada a este endpoint, no un límite general del servidor: eso vive en el
 * borde (proxy o CDN), donde se puede parar antes de gastar un proceso. Aquí se cubre el único
 * sitio que, sin autenticar, provoca un efecto fuera del servidor.
 *
 * Ventana fija y en memoria a propósito: el coste de un almacén compartido no se justifica para
 * un solo endpoint, y con un solo nodo basta. Si algún día hay varios nodos, cada uno aplicará
 * su parte del límite; está anotado en el roadmap junto a las sesiones del MCP.
 */

const MAX = (): number => getEnvNum("CORTEX_AUTH_IP_MAX", 10);
const WINDOW_MS = (): number => getEnvNum("CORTEX_AUTH_IP_WINDOW_MIN", 15) * 60_000;

interface Ventana {
  hasta: number;
  cuenta: number;
}
const ventanas = new Map<string, Ventana>();

/**
 * La IP del cliente. Detrás del proxy propio, `x-forwarded-for` acaba en la IP real y se coge
 * **la última**, no la primera: la primera la escribe quien llama y se puede inventar, así que
 * usarla convertiría el límite en un adorno.
 */
export function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const partes = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const ultima = partes[partes.length - 1];
    if (ultima) return ultima;
  }
  return c.req.header("x-real-ip") ?? "desconocida";
}

/** `true` si esta IP se ha pasado. Cuenta la petición. */
export function demasiadasPeticiones(ip: string, ahora = Date.now()): boolean {
  const v = ventanas.get(ip);
  if (!v || ahora >= v.hasta) {
    ventanas.set(ip, { hasta: ahora + WINDOW_MS(), cuenta: 1 });
    limpia(ahora);
    return false;
  }
  v.cuenta++;
  return v.cuenta > MAX();
}

/** Sin esto el mapa crece con cada IP que pase por aquí y no se vacía nunca. */
function limpia(ahora: number): void {
  if (ventanas.size < 1000) return;
  for (const [ip, v] of ventanas) if (ahora >= v.hasta) ventanas.delete(ip);
}

/** Solo para los tests: deja el contador a cero. */
export function reiniciaLimite(): void {
  ventanas.clear();
}
