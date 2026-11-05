import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ owner: string; repo: string }> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `${owner}/${repo} · Repo profile` };
}

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
