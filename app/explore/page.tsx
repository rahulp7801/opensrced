import { redirect } from "next/navigation";

// Redirect old /explore URL to the new /graph page
export default function ExplorePage() {
  redirect("/graph");
}
