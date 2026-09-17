import { getSql } from "@cortex/database";
import type { EntityType } from "@cortex/shared";
import { contradictingEntryPairs } from "./context-pack.js";
import { listChildProjects } from "./projects.js";
import type { ProjectRef } from "./projects.js";
import type { Row } from "./map.js";

/**
 * Lo que solo se ve mirando a un cliente ENTERO: qué comparten sus repos y dónde se
 * contradicen entre ellos.
 *
 * La herencia del producto SUBE —un hijo lee lo que sabe su cliente, nunca lo de un hermano— y
 * eso está bien: un repo no debe cargar con el contexto de otro. Pero deja una pregunta sin
 * responder, y es justo la que un proyecto padre existe para responder: qué tienen en común
 * sus repos, y dónde uno decidió una cosa y otro la contraria. Hoy eso no lo mira nadie.
 *
 * Bajar es una operación DELIBERADA, no herencia: se hace desde el padre, a mano, y filtrando
 * por permisos en cada paso (ADR-0063).
 */

/**
 * Los tipos de entidad que cuentan como «stack compartido».
 *
 * Fuera quedan `client`, `project` y `repository`. No es un capricho de presentación: el
 * extractor produce entidades ruidosas de esos tres tipos —el nombre del cliente aparece como
 * entidad `client` en cada uno de sus repos, y el nombre de un repo como `repository`— así que
 * incluirlos convertiría la lista en «estos repos comparten… el cliente del que son», que no
 * dice nada. `person` tampoco entra: quién trabajó en algo no es stack.
 */
const TIPOS_DE_STACK: EntityType[] = ["technology", "module", "service", "integration", "vendor"];

/** Una entidad que aparece en la memoria de dos o más hijos del mismo cliente. */
export interface SharedEntity {
  name: string;
  type: EntityType;
  /** En qué hijos aparece. Su número es el orden de la lista: lo compartido por más, arriba. */
  projects: { name: string; slug: string | null }[];
  /** Cuántas entradas vigentes la mencionan en total. Desempata entre cosas compartidas por igual. */
  entries: number;
}

/** Un choque entre dos entradas vigentes de proyectos DISTINTOS del mismo subárbol. */
export interface CrossProjectContradiction {
  a: { id: string; title: string; project: { name: string; slug: string | null } };
  b: { id: string; title: string; project: { name: string; slug: string | null } };
}

export interface AcrossClient {
  /** Los hijos que quien pregunta puede ver. Si está vacío, no hay vista que enseñar. */
  children: ProjectRef[];
  sharedStack: SharedEntity[];
  contradictions: CrossProjectContradiction[];
}

/**
 * La vista transversal de un cliente, ya filtrada por permisos.
 *
 * El filtro vive aquí y no en la interfaz porque es la parte fácil de olvidar: un hijo privado
 * del que `email` no es miembro no puede aparecer ni en el stack compartido ni en las
 * contradicciones, aunque se vea al padre. Todo lo que cruza sale de `listChildProjects`.
 */
export async function getAcrossClient(parent: ProjectRef, email: string | null): Promise<AcrossClient> {
  const children = await listChildProjects(parent.id, email);
  if (children.length === 0) return { children: [], sharedStack: [], contradictions: [] };

  const childIds = children.map((c) => c.id);
  const [sharedStack, contradictions] = await Promise.all([
    sharedStackOf(childIds),
    crossProjectContradictions([parent.id, ...childIds]),
  ]);
  return { children, sharedStack, contradictions };
}

/**
 * Entidades enlazadas desde entradas vigentes de DOS O MÁS de estos proyectos.
 *
 * Las entidades son globales (una fila por tipo y nombre canónico en toda la instalación), así
 * que el cruce ya existe en los datos desde hace tiempo: lo que no había era dónde mirarlo.
 *
 * Es «lo que la memoria tiene enlazado desde varios repos», no un inventario de arquitectura:
 * sale de lo que los agentes escribieron, con su ruido. Por eso se ordena por en cuántos
 * aparece y se corta: una lista larga no se lee, y las primeras filas son las que dicen algo.
 */
async function sharedStackOf(childIds: string[], limit = 40): Promise<SharedEntity[]> {
  const rows = (await getSql()`
    SELECT e.name, e.type,
           count(DISTINCT ce.id)::int AS entries,
           json_agg(DISTINCT jsonb_build_object('name', p.name, 'slug', p.slug)) AS projects
    FROM entities e
    JOIN context_entry_entities cee ON cee.entity_id = e.id
    JOIN context_entries ce ON ce.id = cee.context_entry_id
      AND ce.valid_to IS NULL AND ce.status NOT IN ('rejected', 'obsolete')
      AND ce.project_id = ANY(${childIds})
    JOIN entities p ON p.id = ce.project_id
    WHERE e.type = ANY(${TIPOS_DE_STACK})
    GROUP BY e.id, e.name, e.type
    HAVING count(DISTINCT ce.project_id) >= 2
    ORDER BY count(DISTINCT ce.project_id) DESC, count(DISTINCT ce.id) DESC, e.name
    LIMIT ${limit}
  `) as unknown as Row[];
  return rows.map((r) => ({
    name: r.name as string,
    type: r.type as EntityType,
    entries: Number(r.entries),
    projects: (r.projects as { name: string; slug: string | null }[]).sort((x, y) => x.name.localeCompare(y.name)),
  }));
}

/**
 * Choques entre entradas de proyectos DISTINTOS del subárbol.
 *
 * `lintProject` mira un proyecto, así que una decisión de un repo que choca con la de su
 * hermano no aparecía en el informe de ninguno de los dos. Se reutiliza la consulta de pares
 * del pack y se queda solo con lo que cruza: dentro de un mismo proyecto ya lo cuenta Health.
 */
async function crossProjectContradictions(projectIds: string[]): Promise<CrossProjectContradiction[]> {
  const sql = getSql();
  const pares = await contradictingEntryPairs(sql, projectIds, 50);
  const cruzados = pares.filter((p) => p.a.projectId && p.b.projectId && p.a.projectId !== p.b.projectId);
  if (cruzados.length === 0) return [];

  const ids = [...new Set(cruzados.flatMap((p) => [p.a.projectId!, p.b.projectId!]))];
  const filas = (await sql`SELECT id, name, slug FROM entities WHERE id = ANY(${ids})`) as unknown as Row[];
  const porId = new Map(filas.map((f) => [f.id as string, { name: f.name as string, slug: (f.slug as string) ?? null }]));
  const sinNombre = { name: "?", slug: null };

  return cruzados.map((p) => ({
    a: { id: p.a.id, title: p.a.title, project: porId.get(p.a.projectId!) ?? sinNombre },
    b: { id: p.b.id, title: p.b.title, project: porId.get(p.b.projectId!) ?? sinNombre },
  }));
}
