/**
 * Lectura del JSON que los hooks reciben por stdin, con tope de tiempo.
 *
 * Claude Code y Codex escriben el JSON y **cierran** la tubería, así que un `for await` sobre
 * `process.stdin` termina solo. Pi —y cualquiera que invoque el CLI con `execFile`— deja stdin
 * abierto y mudo: el bucle no acaba nunca, el hook muere por el timeout de quien lo llamó y el
 * agente arranca sin contexto sin que nadie se entere. Así estuvo roto Pi.
 *
 * De ahí el tope: si en `timeoutMs` no ha llegado nada, es que no hay nada que leer. Quien ya
 * sabe lo que necesita (pasa `--cwd`/`--session`) ni siquiera debería llamar aquí.
 */
export async function readHookStdin(timeoutMs = 2000): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  const lector = (async () => {
    for await (const c of process.stdin) chunks.push(c as Buffer);
  })().catch(() => {});

  let corte: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    lector,
    new Promise<void>((resolve) => {
      corte = setTimeout(resolve, timeoutMs);
      corte.unref?.();
    }),
  ]);
  if (corte) clearTimeout(corte);
  process.stdin.pause(); // si se cortó por tiempo, que no siga fluyendo

  return Buffer.concat(chunks).toString("utf8");
}
