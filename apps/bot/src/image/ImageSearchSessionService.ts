import { randomUUID } from "node:crypto";
import type { ImageSearchResponse, ImageSearchResult } from "./ImageSearchService";

export interface ImageSearchSession {
  readonly id: string;
  readonly ownerUserId: string;
  readonly query: string;
  readonly results: readonly ImageSearchResult[];
  readonly index: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ImageSearchSessionService {
  readonly create: (input: {
    readonly ownerUserId: string;
    readonly response: ImageSearchResponse;
    readonly ttlMs?: number;
  }) => ImageSearchSession;
  readonly get: (id: string, now?: number) => ImageSearchSession | undefined;
  readonly move: (id: string, direction: "next" | "prev", now?: number) => ImageSearchSession | undefined;
  readonly prune: (now?: number) => void;
}

export const createImageSearchSessionService = (config: {
  readonly defaultTtlMs: number;
}): ImageSearchSessionService => {
  const sessions = new Map<string, ImageSearchSession>();

  const prune = (now = Date.now()) => {
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(id);
    }
  };

  return {
    create: ({ ownerUserId, response, ttlMs }) => {
      prune();
      const now = Date.now();
      const session: ImageSearchSession = {
        id: randomUUID(),
        ownerUserId,
        query: response.query,
        results: response.results,
        index: 0,
        createdAt: now,
        expiresAt: now + (ttlMs ?? config.defaultTtlMs),
      };
      sessions.set(session.id, session);
      return session;
    },
    get: (id, now = Date.now()) => {
      const session = sessions.get(id);
      if (!session) return undefined;
      if (session.expiresAt <= now) {
        sessions.delete(id);
        return undefined;
      }
      return session;
    },
    move: (id, direction, now = Date.now()) => {
      const session = sessions.get(id);
      if (!session) return undefined;
      if (session.expiresAt <= now) {
        sessions.delete(id);
        return undefined;
      }
      const delta = direction === "next" ? 1 : -1;
      const index = Math.min(Math.max(session.index + delta, 0), session.results.length - 1);
      const updated = { ...session, index };
      sessions.set(id, updated);
      return updated;
    },
    prune,
  };
};
