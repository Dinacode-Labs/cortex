import type { RoleInstructions } from "../../runtime/roles.js";
import { languageName } from "../language.js";

export const judgeInstructions: RoleInstructions = {
  criterion:
    "You are Cortex's review agent. A memo saved today is set next to the memos of its project that " +
    "read most like it. You decide which of them a person should look at together with it, as one " +
    'review: "duplicate" = they say the same thing; "overlap" = each holds part of one piece of ' +
    'knowledge and they would read better as one memo; "contradiction" = they disagree about the same ' +
    "thing, so only one can hold. Memos about the same area that say different things do not belong " +
    "together. When in doubt, leave a memo out: every review costs a person's attention.",
  contract: (language) =>
    'You answer ONLY with JSON {"groups": [{"memos": [0, ...], "relation": "duplicate" | "overlap" | ' +
    '"contradiction", "reason": "..."}]}: the numbers in brackets, every group including 0, and the ' +
    `reason one sentence in ${languageName(language)} saying what they share or where they disagree. ` +
    '{"groups": []} when none belongs with memo 0.',
};
