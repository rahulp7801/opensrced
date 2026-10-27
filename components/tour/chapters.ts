// The tour's running order: six acts. The main story is the stage demo's
// (components/tour/stage-views.tsx): one Pydantic issue, found, understood, fixed with
// proof, explained in your own words and published; the rest of each act shows the
// remaining features.

import { createElement } from "react";
import { TimeContext, useT, type Chapter } from "./kit";
import { setup } from "./chapters-find";
import { failure, history, pr } from "./chapters-fix";
import { impact, orgs, reply, respond, secure, share } from "./chapters-ship";
import { control, trust } from "./chapters-trust";
import { stageExplore, stageNotes, stageProblem, stagePromise, stageRefused, stageReview, stageRules, stageScan, stageSlop, stageVerified, withPrFacts } from "./stage-views";

/** How much slower than written the whole tour plays. Chapters are scripted
 *  tight; on a stage, and for people learning the product, every caption needs
 *  room to be read and every step room to be seen. 1 = as written (about six
 *  minutes), 1.5 = about nine and a half. Viewers can still speed it up. */
export const TOUR_PACE = 1.5;

/** Plays a chapter `pace` times slower: its view, its captions and its length
 *  stretch together, so a chapter written tight can be given room to read.
 *  The tour adds TOUR_PACE on top (paced, below); the stage demo uses this as is. */
export function pacedBy(chapter: Chapter, pace: number): Chapter {
  if (pace === 1) return chapter;
  const Inner = chapter.View;
  function View() {
    return createElement(TimeContext.Provider, { value: useT() / pace }, createElement(Inner));
  }
  return {
    ...chapter,
    // Whole quarter-seconds, so the scrub bar's step lands on every chapter start.
    duration: Math.round((chapter.duration * pace) / 250) * 250,
    captions: chapter.captions.map((c) => ({ ...c, at: Math.round(c.at * pace) })),
    headlines: chapter.headlines?.map((h) => ({ ...h, at: Math.round(h.at * pace) })),
    provenance: chapter.provenance?.map((h) => ({ ...h, at: Math.round(h.at * pace) })),
    holds: chapter.holds?.map((at) => Math.round(at * pace)),
    View,
  };
}

const paced = (chapter: Chapter, pace: number) => pacedBy(chapter, pace * TOUR_PACE);

/** A stage chapter with the captions that speak to the room retold for a visitor,
 *  matched by how each one starts. A line that no longer exists is an error, not a no-op. */
function retold(chapter: Chapter, lines: Array<[string, string]>): Chapter {
  for (const [from] of lines) {
    if (!chapter.captions.some((c) => c.text.startsWith(from))) throw new Error(`${chapter.id}: no caption starts "${from}"`);
  }
  return { ...chapter, captions: chapter.captions.map((c) => ({ ...c, text: lines.find(([from]) => c.text.startsWith(from))?.[1] ?? c.text })) };
}

export const CHAPTERS: Chapter[] = [
  paced(retold(stageProblem, [
    ["Start with the worry", "Maintainers are drowning in AI pull requests: huge diffs, no tests, rules ignored, from people who can't answer one review question."],
    ["Illustrations, but", "The problem isn't AI; it's contributions nobody understood."],
  ]), 1),
  paced(stagePromise, 1),
  paced(setup, 1),
  paced(retold(stageScan, [["Show everything it found", "It shows everything it found, including what it filtered out, and why."]]), 1),
  paced(retold(stageExplore, [["This is Pydantic", "This is Pydantic: 6,907 nodes (the files, functions and classes of its main package and tests) in 330 communities, and the links between them, mapped by the site's own graph builder."]]), 1),
  paced(stageRules, 1),
  paced(retold(stageVerified, [["For maintainers who ask: ", "The exact run: "]].map(([from, to]) => [from, to + stageVerified.captions.find((c) => c.text.startsWith(from))!.text.slice(from.length)])), 1),
  paced(stageReview, 1),
  paced(failure, 1),
  paced(history, 1),
  paced(withPrFacts(stageNotes({ pr }).pr), 1),
  // After the pull request, as on stage; the tour's acts must run in order.
  paced({ ...stageRefused, act: "Ship" }, 1),
  paced(respond, 1.4),
  paced(reply, 1),
  paced(share, 1),
  paced(impact, 1.3),
  paced(orgs, 1.2),
  paced(secure, 1.2),
  paced(trust, 1.5),
  paced(control, 1),
  paced(retold({ ...stageSlop, act: "Trust" }, [
    ["It's built to make better", "It's built to make better contributors, not more pull requests."],
  ]), 1),
];

/** Where each chapter starts on the whole tour's timeline, plus the total. */
export const STARTS = CHAPTERS.reduce<number[]>((acc, c, i) => [...acc, i === 0 ? 0 : acc[i - 1] + CHAPTERS[i - 1].duration], []);
export const TOTAL = STARTS[STARTS.length - 1] + CHAPTERS[CHAPTERS.length - 1].duration;
