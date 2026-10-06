import type { ContextEntryType } from "@cortex/shared";

export interface MemoTypeDefinition {
  is: string;
  isNot: string;
}

export const MEMO_TYPE_DEFINITIONS: Record<ContextEntryType, MemoTypeDefinition> = {
  decision: {
    is: "a choice that was made and is in force, with its reason",
    isNot: "a proposal, a list of options or a question still open",
  },
  constraint: {
    is: "something that must or cannot be done, imposed from outside the team: a client, the law, the infrastructure",
    isNot: "a preference of the team, which is a convention",
  },
  incident: {
    is: "a failure that happened in the project, with its cause and how it was resolved",
    isNot: "a hiccup of one session or of one person's local environment",
  },
  architecture: {
    is: "how the system is built: its parts, how they connect and why",
    isNot: "a detail inside one part that changes nothing about how the parts fit",
  },
  technical_debt: {
    is: "something left wrong on purpose that will need fixing, and what it costs in the meantime",
    isNot: "a failure that already happened, which is an incident",
  },
  convention: {
    is: "a rule the team follows when writing or shipping, stated as a fact",
    isNot: "a rule imposed from outside the team, which is a constraint",
  },
  business_rule: {
    is: "a rule of the business the software has to respect: how something is billed, calculated or allowed",
    isNot: "a technical rule of the team, which is a convention",
  },
  integration_note: {
    is: "how the project talks to an external system: its endpoints, limits and quirks",
    isNot: "what the external system's own documentation already says",
  },
  risk: {
    is: "something fragile or dangerous that has not failed yet, or an open question that blocks work",
    isNot: "a failure that already happened, which is an incident",
  },
  how_to: {
    is: "the steps to do something in this project that are not obvious",
    isNot: "what the repository's own documentation already explains",
  },
  meeting_summary: {
    is: "what a meeting decided and what it left pending",
    isNot: "knowledge from a working session, which goes under the type it describes",
  },
  pr_summary: {
    is: "what a pull request changed and why",
    isNot: "knowledge from a working session, which goes under the type it describes",
  },
  ticket_resolution: {
    is: "how a ticket was resolved",
    isNot: "knowledge from a working session, which goes under the type it describes",
  },
  other: {
    is: "durable knowledge about the project that none of the other types describes",
    isNot: "a place for noise: what is not worth keeping is not kept",
  },
};
