// The tour's running order: six acts, about six minutes. The main story
// follows one real issue (find it, understand it, run it, review it, ship it);
// the rest of each act shows the remaining features.

import { createElement } from "react";
import { TimeContext, useT, type Chapter } from "./kit";
import { choose, find, intro, setup, suggested, understand } from "./chapters-find";
import { failure, history, newRun, pr, review, run } from "./chapters-fix";
import { impact, orgs, reply, respond, secure, share } from "./chapters-ship";
import { control, outro, trust } from "./chapters-trust";

/** Plays a chapter `pace` times slower: its view, its captions and its length
 *  stretch together, so a chapter written tight can be given room to read. */
function paced(chapter: Chapter, pace: number): Chapter {
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
    View,
  };
}

export const CHAPTERS: Chapter[] = [
  paced(intro, 1.5),
  setup,
  paced(find, 1.4),
  suggested,
  paced(choose, 1.3),
  paced(understand, 1.3),
  newRun,
  paced(run, 1.3),
  paced(review, 1.4),
  failure,
  history,
  paced(pr, 1.25),
  paced(respond, 1.4),
  reply,
  share,
  paced(impact, 1.3),
  paced(orgs, 1.2),
  paced(secure, 1.2),
  paced(trust, 1.5),
  control,
  paced(outro, 1.3),
];

/** Where each chapter starts on the whole tour's timeline, plus the total. */
export const STARTS = CHAPTERS.reduce<number[]>((acc, c, i) => [...acc, i === 0 ? 0 : acc[i - 1] + CHAPTERS[i - 1].duration], []);
export const TOTAL = STARTS[STARTS.length - 1] + CHAPTERS[CHAPTERS.length - 1].duration;
