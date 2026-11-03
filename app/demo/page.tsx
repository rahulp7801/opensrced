import { redirect } from "next/navigation";

// The demo is the stage demo: one link to share, on any screen.
export default function DemoPage() {
  redirect("/demo/stage");
}
