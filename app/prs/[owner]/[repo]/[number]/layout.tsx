export async function generateMetadata({ params }: { params: Promise<{ owner: string; repo: string; number: string }> }) {
  const { owner, repo, number } = await params;
  return { title: `PR #${number} · ${owner}/${repo}` };
}

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
