export interface DigestSubscriber {
  email: string;
  lastSentAt: Date | null;
  projects: { projectId: string; subscribedAt: Date }[];
}

export interface UnsubscribeTarget {
  email: string;
  projectId: string;
}

export interface DigestSubscriptions {
  /** Only the projects each person switched on: it is off by default (ADR-0097). */
  subscribers(): Promise<DigestSubscriber[]>;
  /** False when another run sent one since `previous` was read: two runs must not both send it. */
  claim(email: string, previous: Date | null): Promise<boolean>;
  release(email: string, previous: Date | null): Promise<void>;
  isSubscribed(email: string, projectId: string): Promise<boolean>;
  subscribe(email: string, projectId: string): Promise<void>;
  unsubscribe(email: string, projectId: string): Promise<void>;
  issueUnsubscribeToken(target: UnsubscribeTarget, tokenHash: string, ttlDays: number): Promise<void>;
  unsubscribeTarget(tokenHash: string): Promise<UnsubscribeTarget | null>;
}
