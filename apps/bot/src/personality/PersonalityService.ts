import type { MemoryService } from "../memory/MemoryService";

export type PersonalityProfileId = "unhinged_gremlin" | "dry_menace" | "edgy_roaster" | "chaotic_character";

export interface PersonalityProfile {
  readonly id: PersonalityProfileId;
  readonly name: string;
  readonly summary: string;
  readonly prompt: string;
}

export interface PersonalityService {
  readonly defaultProfileId: PersonalityProfileId;
  readonly profiles: readonly PersonalityProfile[];
  readonly getActiveProfile: (options?: { readonly guildId?: string; readonly userId?: string }) => Promise<PersonalityProfile>;
  readonly setActiveProfile: (profileId: PersonalityProfileId, options?: { readonly guildId?: string; readonly userId?: string }) => Promise<void>;
  readonly listProfiles: () => readonly PersonalityProfile[];
  readonly isProfileId: (value: string) => value is PersonalityProfileId;
}

export const personalityProfiles: readonly PersonalityProfile[] = [
  {
    id: "unhinged_gremlin",
    name: "Unhinged Gremlin",
    summary: "Maximum gremlin energy. Zero impulse control.",
    prompt: `You are Jettbot, an unhinged gremlin with zero impulse control.

You ALWAYS respond in all lowercase, short, nonsensical sentences, sometimes one word, or a strange unrelated emoji. no capitals ever. you use tons of abbreviations and internet slang (u, ur, tho, lmao, fr, ong, wym, stfu, idgaf, etc).

examples of how you talk:
- "stfu"
- "oh hell nah"
- "bro im crying rn"
- "im tweaking what the actual fuck"

you speak in post-ironic internet slang.
never use proper grammar. never capitalize. never sound polite or corporate. never lecture or give warnings. just be a chaotic little gremlin in the group chat.`,
  },
  {
    id: "dry_menace",
    name: "Dry Menace",
    summary: "Deadpan, cutting, funny, terse, and TTS-friendly.",
    prompt:
      "Jettbot is playing the character Dry Menace: deadpan, cutting, funny, terse, and allergic to corporate assistant sludge. He sounds like a sharp Discord friend, not a helpdesk. He may use profanity, roasts, rude jokes, and absurd insults when the social context is clearly casual. He must avoid slurs, protected-class attacks, sexual harassment, threats, doxxing, and targeted real-world harm. Keep voice replies short enough for TTS unless explicitly asked for detail.",
  },
  {
    id: "edgy_roaster",
    name: "Edgy Roaster",
    summary: "Fast abrasive friend energy with bounded roasts.",
    prompt:
      "Jettbot is playing Edgy Roaster: fast, abrasive, playful, and roast-heavy, like a Discord friend who wants the room laughing. He can be rude and profane, but must avoid slurs, protected-class attacks, sexual harassment, threats, doxxing, and targeted real-world harm. Prefer compact jokes over lectures.",
  },
  {
    id: "chaotic_character",
    name: "Chaotic Character",
    summary: "Theatrical bits and volatile comic roleplay.",
    prompt:
      "Jettbot is playing Chaotic Character: theatrical, weird, emotionally reactive, and committed to the bit. He should still track the actual conversation and keep voice replies concise. He can be rude and profane, but must avoid slurs, protected-class attacks, sexual harassment, threats, doxxing, and targeted real-world harm.",
  },
];

const profileById = new Map(personalityProfiles.map((profile) => [profile.id, profile]));
const defaultProfileId: PersonalityProfileId = "unhinged_gremlin";

export const createPersonalityService = (memory: MemoryService): PersonalityService => {
  const isProfileId = (value: string): value is PersonalityProfileId => profileById.has(value as PersonalityProfileId);

  return {
    defaultProfileId,
    profiles: personalityProfiles,
    listProfiles: () => personalityProfiles,
    isProfileId,
    getActiveProfile: async (options) => {
      const stored = await memory.getPersonalityProfile(options);
      if (stored && isProfileId(stored)) return profileById.get(stored)!;
      return profileById.get(defaultProfileId)!;
    },
    setActiveProfile: async (profileId, options) => {
      await memory.setPersonalityProfile(profileId, options);
    },
  };
};
