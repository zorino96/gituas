// Which workspace a person is acting in when they belong to several: the one
// their cookie names (only if it is still theirs), else their earliest claimed
// one, else their earliest. Claimed first, so an invitee's empty placeholder
// workspace never wins over the desk they joined.

export interface WorkspaceCandidate {
  id: string;
  kindChosen: boolean;
  joinedAt: Date;
}

export function pickWorkspace<T extends WorkspaceCandidate>(candidates: readonly T[], cookieId?: string | null): T | undefined {
  if (cookieId) {
    const chosen = candidates.find((c) => c.id === cookieId);
    if (chosen) return chosen;
  }
  const byAge = [...candidates].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  return byAge.find((c) => c.kindChosen) ?? byAge[0];
}
