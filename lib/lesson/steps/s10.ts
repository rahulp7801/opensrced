// s10 Next steps: the contributor writes their own. Not graded; it feeds
// follow-ups (Phase 5).

import { textAnswer, type StepDef } from "./shared";

export const s10: StepDef<string> = {
  id: "s10",
  title: "Next steps",
  question: "What will you do next with this project? (Follow the PR, pick a related issue, read a part you now understand…)",
  hintQuestion: "Which part of the project would you like to understand better after this?",
  nudge: "Look at the issues labelled \"good first issue\" near the area you just worked in.",
  needs: [],
  parseAnswer: (raw) => textAnswer(raw, 1, 2000),
  grade: () => null,
};
