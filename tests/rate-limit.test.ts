import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clientIp, demasiadasPeticiones, reiniciaLimite } from "../apps/server/src/rate-limit.js";

/**
 * `requestOtp` ya limita por dirección de correo, lo que impide machacar a una persona. Lo que
 * no impedía es pedir códigos para muchas direcciones distintas desde una sola IP: cada una
 * estrena su propio cupo. Con el envío de correo activo, eso son mensajes de verdad y una
 * factura de verdad.
 */
describe("límite por IP del envío de códigos", () => {
  beforeEach(() => reiniciaLimite());
  afterEach(() => vi.unstubAllEnvs());

  it("deja pasar hasta el tope y corta a partir de ahí", () => {
    vi.stubEnv("CORTEX_AUTH_IP_MAX", "3");
    for (let i = 0; i < 3; i++) expect(demasiadasPeticiones("1.2.3.4")).toBe(false);
    expect(demasiadasPeticiones("1.2.3.4")).toBe(true);
    expect(demasiadasPeticiones("1.2.3.4")).toBe(true);
  });

  it("cada IP lleva su propia cuenta", () => {
    vi.stubEnv("CORTEX_AUTH_IP_MAX", "1");
    expect(demasiadasPeticiones("1.1.1.1")).toBe(false);
    expect(demasiadasPeticiones("2.2.2.2")).toBe(false); // otra IP, cupo propio
    expect(demasiadasPeticiones("1.1.1.1")).toBe(true);
  });

  it("al pasar la ventana se vuelve a empezar", () => {
    vi.stubEnv("CORTEX_AUTH_IP_MAX", "1");
    vi.stubEnv("CORTEX_AUTH_IP_WINDOW_MIN", "15");
    const t0 = 1_000_000;
    expect(demasiadasPeticiones("9.9.9.9", t0)).toBe(false);
    expect(demasiadasPeticiones("9.9.9.9", t0 + 1000)).toBe(true);
    expect(demasiadasPeticiones("9.9.9.9", t0 + 16 * 60_000)).toBe(false);
  });

  /**
   * Lo que de verdad decide si esto sirve de algo: de qué IP nos fiamos. La primera entrada de
   * `x-forwarded-for` la escribe quien llama y se puede inventar; la última la pone el proxy
   * propio. Coger la primera convertiría el límite en un adorno.
   */
  it("se queda con la IP que pone el proxy, no con la que dice el cliente", () => {
    const req = (cabeceras: Record<string, string>) =>
      ({ req: { header: (n: string) => cabeceras[n.toLowerCase()] } }) as never;

    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(req({}))).toBe("desconocida");
  });

  it("todas las peticiones sin IP conocida comparten cupo, que es lo prudente", () => {
    vi.stubEnv("CORTEX_AUTH_IP_MAX", "1");
    expect(demasiadasPeticiones("desconocida")).toBe(false);
    expect(demasiadasPeticiones("desconocida")).toBe(true);
  });
});
