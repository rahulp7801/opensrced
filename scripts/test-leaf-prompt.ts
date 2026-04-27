// Synthetic verification: feed classifyScope a body that names ONE source
// file and check (a) it bucketed as leaf, (b) isFastPathScope agrees.
// Then build the leaf prompt and dump it so we can eyeball the output.
import { classifyScope } from "../lib/scope.ts";

const cases = [
  {
    title: "Fix typo in app/page.tsx",
    body: "There's a typo in `app/page.tsx` line 12. The word 'recieve' should be 'receive'.",
  },
  {
    title: "Update README link",
    body: "Broken link in README.md — points to /old-path, should point to /new-path.",
  },
  {
    title: "Add tests for parseRepo helper",
    body: "The function `parseRepo` in `lib/utils.ts` lacks unit tests. Add tests covering 5 input forms.",
  },
];

for (const c of cases) {
  const s = classifyScope(c.title, c.body);
  const fast = (s.bucket === "doc") ||
               (s.bucket === "leaf" && s.confidence !== "low" && s.files.length > 0);
  console.log(`TITLE: ${c.title}`);
  console.log(`  bucket=${s.bucket} conf=${s.confidence} files=${s.files.join(",")}`);
  console.log(`  fastPath=${fast ? "YES (leaf prompt)" : "no (full prompt)"}`);
  console.log();
}
