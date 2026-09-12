import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/demo"],
      disallow: [
        "/api/",
        "/crucible",
        "/discover",
        "/dispatches",
        "/explore",
        "/fix/",
        "/graph",
        "/issues",
        "/login",
        "/prs",
        "/repos",
        "/stats",
        "/trigger",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
