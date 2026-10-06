import type { EntityType } from "@cortex/shared";
import type { ProjectRef } from "../../projects/domain/project.js";

/**
 * What can only be seen by looking at a WHOLE client: what its repos share, and where they
 * contradict each other.
 *
 * The product's inheritance goes UP -- a child reads what its client knows, never what a
 * sibling knows -- and that is right: a repo should not carry another's context. But it leaves
 * one question unanswered, and it is precisely the one a parent project exists to answer: what
 * its repos have in common, and where one decided one thing and another the opposite. Nobody
 * looks at that today.
 *
 * Going down is a DELIBERATE operation, not inheritance: it happens from the parent, by hand,
 * and filtered by permissions at every step (ADR-0063).
 */

/**
 * The entity types that count as "shared stack".
 *
 * `client`, `project` and `repository` are left out. This is not a presentation whim: the
 * extractor produces noisy entities of those three types -- the client's name appears as a
 * `client` entity in every one of its repos, and a repo's name as a `repository` -- so
 * including them would turn the list into "these repos share... the client they belong to",
 * which says nothing. `person` is out too: who worked on something is not stack.
 */
export const STACK_TYPES: EntityType[] = ["technology", "module", "service", "integration", "vendor"];

export interface SharedEntity {
  name: string;
  type: EntityType;
  projects: { name: string; slug: string | null }[];
  entries: number;
}

export interface CrossProjectContradiction {
  a: { id: string; title: string; project: { name: string; slug: string | null } };
  b: { id: string; title: string; project: { name: string; slug: string | null } };
}

export interface AcrossClient {
  children: ProjectRef[];
  sharedStack: SharedEntity[];
  contradictions: CrossProjectContradiction[];
}
