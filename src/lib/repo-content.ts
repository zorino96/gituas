import { Octokit } from "@octokit/rest";
import { db } from "./db";

export interface RepoSnapshot {
  owner: string;
  repo: string;
  defaultBranch: string;
  files: { path: string; content: string; size: number }[];
}

const INTERESTING_PATHS = [
  "README.md",
  "readme.md",
  "Readme.md",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  "app/page.tsx",
  "pages/index.tsx",
  "src/app/page.tsx",
  "index.html",
  "src/index.html",
  "src/main.tsx",
  "src/App.tsx",
  "Cargo.toml",
  "requirements.txt",
  "pyproject.toml",
  "Gemfile",
  "composer.json",
  "go.mod",
];

async function octokitForUser(userId: string): Promise<Octokit | null> {
  // Pull the GitHub OAuth access_token from the Account row created by Auth.js.
  const acct = await db.account.findFirst({
    where: { userId, provider: "github" },
    select: { access_token: true },
  });
  if (!acct?.access_token) return null;
  return new Octokit({ auth: acct.access_token });
}

export async function fetchRepoSnapshot(
  userId: string,
  owner: string,
  repo: string,
): Promise<RepoSnapshot | null> {
  const gh = await octokitForUser(userId);
  if (!gh) return null;

  let info;
  try {
    info = await gh.repos.get({ owner, repo });
  } catch {
    return null;
  }

  const defaultBranch = info.data.default_branch;
  const files: RepoSnapshot["files"] = [];

  for (const path of INTERESTING_PATHS) {
    try {
      const res = await gh.repos.getContent({ owner, repo, path, ref: defaultBranch });
      if (Array.isArray(res.data)) continue;
      if (res.data.type !== "file" || !("content" in res.data)) continue;
      const decoded = Buffer.from(res.data.content, "base64").toString("utf8");
      files.push({ path, content: decoded, size: res.data.size });
    } catch {
      // file doesn't exist — skip silently
    }
  }

  return { owner, repo, defaultBranch, files };
}

export function formatRepoSnapshot(snap: RepoSnapshot): string {
  const parts: string[] = [];
  parts.push(`# Repository: ${snap.owner}/${snap.repo}`);
  parts.push(`# Default branch: ${snap.defaultBranch}`);
  parts.push("");
  for (const f of snap.files) {
    parts.push(`## File: ${f.path} (${f.size} bytes)`);
    parts.push("```");
    parts.push(f.content.slice(0, 10_000)); // cap each file at 10K chars
    parts.push("```");
    parts.push("");
  }
  return parts.join("\n");
}
