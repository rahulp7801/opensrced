import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  return [
    { url: origin, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/demo`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
