import type { Metadata } from "next";
import { StageNotes } from "@/components/tour/stage";

export const metadata: Metadata = {
  title: "Speaker notes",
  robots: { index: false },
};

export default function StageNotesPage() {
  return <StageNotes />;
}
