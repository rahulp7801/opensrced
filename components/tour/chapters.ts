// The tour's running order: six acts. The main story
// follows one real issue (find it, understand it, run it, review it, ship it);
// the rest of each act shows the remaining features.

import { createElement } from "react";
import { TimeContext, useT, type Chapter } from "./kit";
import { choose, find, intro, setup, suggested, understand } from "./chapters-find";
import { failure, history, newRun, pr, review, run } from "./chapters-fix";
import { impact, orgs, reply, respond, secure, share } from "./chapters-ship";
import { control, outro, trust } from "./chapters-trust";

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
    View,
  };
}

const paced = (chapter: Chapter, pace: number) => pacedBy(chapter, pace * TOUR_PACE);

export const CHAPTERS: Chapter[] = [
  paced(intro, 1.5),
  paced(setup, 1),
  paced(find, 1.4),
  paced(suggested, 1),
  paced(choose, 1.3),
  paced(understand, 1.3),
  paced(newRun, 1),
  paced(run, 1.3),
  paced(review, 1.4),
  paced(failure, 1),
  paced(history, 1),
  paced(pr, 1.25),
  paced(respond, 1.4),
  paced(reply, 1),
  paced(share, 1),
  paced(impact, 1.3),
  paced(orgs, 1.2),
  paced(secure, 1.2),
  paced(trust, 1.5),
  paced(control, 1),
  paced(outro, 1.3),
];

/** Where each chapter starts on the whole tour's timeline, plus the total. */
export const STARTS = CHAPTERS.reduce<number[]>((acc, c, i) => [...acc, i === 0 ? 0 : acc[i - 1] + CHAPTERS[i - 1].duration], []);
export const TOTAL = STARTS[STARTS.length - 1] + CHAPTERS[CHAPTERS.length - 1].duration;
