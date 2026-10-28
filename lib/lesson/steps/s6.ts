// s6 Research: look at worked examples and related docs, and note what
// helps. Not graded; the notes feed s7. (Similar issues come from Phase 2.)

import { textAnswer, type StepDef } from "./shared";

export const s6: StepDef<string> = {
  id: "s6",
  title: "Research",
  question: "Look at a related closed issue, its pull request, or the docs for this area. What did you learn that could help?",
  hintQuestion: "Has this project fixed something similar before? What did that change touch?",
  nudge: "Search the closed issues for words from this issue's title, and open the pull request that closed one.",
  needs: ["issue"],
  parseAnswer: (raw) => textAnswer(raw, 1, 3000),
  grade: () => null,
};
