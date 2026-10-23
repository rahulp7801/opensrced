import type { Metadata } from "next";
import { StageDemo } from "@/components/tour/stage";

export const metadata: Metadata = {
  title: "Stage demo",
  description: "opensrcer in four phases, for presenting: click through and talk over it.",
  robots: { index: false },
};

export default function StagePage() {
  return <StageDemo />;
}
