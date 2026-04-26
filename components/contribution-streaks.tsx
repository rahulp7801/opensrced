"use client";

import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";

type ContribDay = {
  date: string; // YYYY-MM-DD
  count: number;
};

const STORAGE_KEY = "opensrcer-contributions";
const WEEKS_TO_SHOW = 12;

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadContributions(): ContribDay[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ContribDay[];
  } catch { return []; }
}

function saveContributions(data: ContribDay[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function recordContribution() {
  const today = getToday();
  const data = loadContributions();
  const existing = data.find((d) => d.date === today);
  if (existing) {
    existing.count++;
  } else {
    data.push({ date: today, count: 1 });
  }
  // Keep only last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const filtered = data.filter((d) => new Date(d.date) >= cutoff);
  saveContributions(filtered);
}

export function ContributionStreaks() {
  const [data, setData] = useState<ContribDay[]>([]);

  useEffect(() => {
    setData(loadContributions());
    // Listen for storage changes (same-tab updates)
    const interval = setInterval(() => setData(loadContributions()), 5000);
    return () => clearInterval(interval);
  }, []);

  const { grid, currentStreak, longestStreak, totalContribs, thisWeek, reposCount } = useMemo(() => {
    const today = new Date();
    const days = WEEKS_TO_SHOW * 7;
    const grid: Array<{ date: string; count: number; level: number }> = [];

    const contribMap = new Map(data.map((d) => [d.date, d.count]));

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const count = contribMap.get(dateStr) ?? 0;
      const level = count === 0 ? 0 : count <= 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4;
      grid.push({ date: dateStr, count, level });
    }

    // Current streak
    let currentStreak = 0;
    for (let i = grid.length - 1; i >= 0; i--) {
      if (grid[i].count > 0) currentStreak++;
      else break;
    }

    // Longest streak
    let longestStreak = 0;
    let streak = 0;
    for (const g of grid) {
      if (g.count > 0) { streak++; longestStreak = Math.max(longestStreak, streak); }
      else streak = 0;
    }

    const totalContribs = data.reduce((sum, d) => sum + d.count, 0);

    // This week
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const thisWeek = data.filter((d) => d.date >= weekStartStr).reduce((sum, d) => sum + d.count, 0);

    return { grid, currentStreak, longestStreak, totalContribs, thisWeek, reposCount: 0 };
  }, [data]);

  const weeks: Array<Array<typeof grid[number]>> = [];
  for (let i = 0; i < grid.length; i += 7) {
    weeks.push(grid.slice(i, i + 7));
  }

  return (
    <div className="border border-border bg-surface/40">
      <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.15em] text-signal">Contribution activity</span>
        <span className="text-[10px] text-paper-faint">{WEEKS_TO_SHOW} weeks</span>
      </div>

      {/* Stats row */}
      <div className="px-4 py-3 border-b border-border-soft grid grid-cols-4 gap-4">
        <div>
          <div className="text-[18px] text-paper font-medium tabular-nums">{totalContribs}</div>
          <div className="text-[10px] text-paper-faint">total fixes</div>
        </div>
        <div>
          <div className="text-[18px] text-signal font-medium tabular-nums">{currentStreak}</div>
          <div className="text-[10px] text-paper-faint">day streak</div>
        </div>
        <div>
          <div className="text-[18px] text-ok font-medium tabular-nums">{longestStreak}</div>
          <div className="text-[10px] text-paper-faint">best streak</div>
        </div>
        <div>
          <div className="text-[18px] text-info font-medium tabular-nums">{thisWeek}</div>
          <div className="text-[10px] text-paper-faint">this week</div>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="px-4 py-3">
        <div className="flex gap-[3px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date}: ${day.count} contribution${day.count !== 1 ? "s" : ""}`}
                  className={cn(
                    "w-[11px] h-[11px] border",
                    day.level === 0 && "bg-ink border-border-soft",
                    day.level === 1 && "bg-signal/20 border-signal/30",
                    day.level === 2 && "bg-signal/40 border-signal/50",
                    day.level === 3 && "bg-signal/60 border-signal/70",
                    day.level === 4 && "bg-signal/80 border-signal/90",
                  )}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1 text-[9px] text-paper-faint">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className={cn(
                "w-[9px] h-[9px] border",
                level === 0 && "bg-ink border-border-soft",
                level === 1 && "bg-signal/20 border-signal/30",
                level === 2 && "bg-signal/40 border-signal/50",
                level === 3 && "bg-signal/60 border-signal/70",
                level === 4 && "bg-signal/80 border-signal/90",
              )}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
