import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";
import { inviteOnly } from "@/lib/access";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  return [
    { url: origin, changeFrequency: "monthly", priority: 1 },
    // The demo is invite-only during the private preview.
    ...(inviteOnly() ? [] : [{ url: `${origin}/demo`, changeFrequency: "monthly" as const, priority: 0.8 }]),
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
