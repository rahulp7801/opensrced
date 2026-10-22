import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  return [
    { url: origin, changeFrequency: "monthly", priority: 1 },
    // The product tour is public in every mode, the private preview included.
    { url: `${origin}/demo`, changeFrequency: "monthly" as const, priority: 0.8 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
