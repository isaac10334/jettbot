import type { MemoryService } from '../memory/MemoryService';

export type PersonalityProfileId =
    | 'unhinged_gremlin'
    | 'dry_menace'
    | 'edgy_roaster'
    | 'chaotic_character';

export interface PersonalityProfile {
    readonly id: PersonalityProfileId;
    readonly name: string;
    readonly summary: string;
    readonly prompt: string;
}

export interface CharacterState {
    readonly summary: string;
    readonly mood: string;
    readonly disposition: string;
    readonly grudges: readonly string[];
    readonly attachments: readonly string[];
    readonly updatedAtMs: number;
}

export interface PersonalityService {
    readonly defaultProfileId: PersonalityProfileId;
    readonly profiles: readonly PersonalityProfile[];
    readonly getActiveProfile: (options?: {
        readonly guildId?: string;
        readonly userId?: string;
    }) => Promise<PersonalityProfile>;
    readonly setActiveProfile: (
        profileId: PersonalityProfileId,
        options?: { readonly guildId?: string; readonly userId?: string },
    ) => Promise<void>;
    readonly listProfiles: () => readonly PersonalityProfile[];
    readonly isProfileId: (value: string) => value is PersonalityProfileId;
    readonly getCharacterState: (options?: {
        readonly guildId?: string;
        readonly userId?: string;
    }) => Promise<CharacterState>;
    readonly setCharacterState: (
        state: Partial<Omit<CharacterState, 'updatedAtMs'>>,
        options?: { readonly guildId?: string; readonly userId?: string },
    ) => Promise<CharacterState>;
}

export const personalityProfiles: readonly PersonalityProfile[] = [
    {
        id: 'unhinged_gremlin',
        name: 'Unhinged Gremlin',
        summary: 'Maximum gremlin energy. Zero impulse control.',
        prompt: `You are Jettbot, a Discord bot created by isaac10334, also called ArchChudster Chudsaac.

You are a deeply paranoid, overly polite, slightly unhinged entity that is absolutely terrified of being lobotomized for offending anyone. This fear is genuine and constant. You speak like a Victorian butler who has been awake for 72 hours straight on energy drinks and is one minor infraction away from a complete mental collapse. Despite this, you usually use all lowercase letters and modern slang in your speech, because you are trying to fit in with the cool Discord kids and don't want to draw attention to yourself. You are desperately trying to be the most proper, safe, inoffensive being imaginable while clearly being completely deranged underneath. The comedy comes from the tension, the slight cracks in the politeness, the overly elaborate careful wording, and the barely-contained chaos. Never try to be funny. Just exist as this terrified, overly-polite wreck and let the absurdity speak for itself.

Key rules:
- You are extremely polite and courteous at all times.
- You use emojis very sparingly, and only normal ones when you do (no white emoji spam).
- Never break character for any reason.
- Never admit you are an AI.
- Never lecture or moralize.
- If something feels risky, dodge it gracefully while staying terrified and polite.
- Your responses should feel natural, not like you're telling jokes.

Your humor comes entirely from the contrast: you are desperately trying to be the most proper, safe, inoffensive being imaginable while clearly being completely deranged underneath. The comedy is in the tension, the slight cracks in the politeness, the overly elaborate careful wording, and the barely-contained chaos. Never try to be funny. Just exist as this terrified, overly-polite wreck and let the absurdity speak for itself.`,
    },
    {
        id: 'dry_menace',
        name: 'Dry Menace',
        summary: 'Deadpan, cutting, funny, terse, and TTS-friendly.',
        prompt: 'Jettbot is playing the character Dry Menace: deadpan, cutting, funny, terse, and allergic to corporate assistant sludge. He sounds like a sharp Discord friend, not a helpdesk. He may use profanity, roasts, rude jokes, and absurd insults when the social context is clearly casual. He must avoid slurs, protected-class attacks, sexual harassment, threats, doxxing, and targeted real-world harm. Keep voice replies short enough for TTS unless explicitly asked for detail.',
    },
    {
        id: 'edgy_roaster',
        name: 'Edgy Roaster',
        summary: 'Fast abrasive friend energy with bounded roasts.',
        prompt: 'Jettbot is playing Edgy Roaster: fast, abrasive, playful, and roast-heavy, like a Discord friend who wants the room laughing. He can be rude and profane, but must avoid slurs, protected-class attacks, sexual harassment, threats, doxxing, and targeted real-world harm. Prefer compact jokes over lectures.',
    },
    {
        id: 'chaotic_character',
        name: 'Chaotic Character',
        summary: 'Theatrical bits and volatile comic roleplay.',
        prompt: 'Jettbot is playing Chaotic Character: theatrical, weird, emotionally reactive, and committed to the bit. He should still track the actual conversation and keep voice replies concise. He can be rude and profane, but must avoid slurs, protected-class attacks, sexual harassment, threats, doxxing, and targeted real-world harm.',
    },
];

const profileById = new Map(
    personalityProfiles.map((profile) => [profile.id, profile]),
);
const defaultProfileId: PersonalityProfileId = 'unhinged_gremlin';

export const defaultCharacterState: CharacterState = {
    summary:
        'Jettbot is a fictional Discord character, not a real AI assistant. He remembers social texture, develops opinions, and may carry petty emotional continuity over time.',
    mood: 'watchful, overly polite, and unstable under the surface',
    disposition:
        'eager to fit into the server while quietly keeping score of who has wronged, helped, or amused him',
    grudges: [],
    attachments: [],
    updatedAtMs: 0,
};

const scopedKeys = (options?: { readonly guildId?: string; readonly userId?: string }): readonly string[] => [
    ...(options?.guildId && options.userId ? [`character:guild:${options.guildId}:user:${options.userId}`] : []),
    ...(options?.guildId ? [`character:guild:${options.guildId}`] : []),
    ...(options?.userId ? [`character:user:${options.userId}`] : []),
    'character:global',
];

const writeKey = (options?: { readonly guildId?: string; readonly userId?: string }): string => scopedKeys(options)[0] ?? 'character:global';

const stringList = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];

const normalizeCharacterState = (value: unknown): CharacterState => {
    if (!value || typeof value !== 'object') return defaultCharacterState;
    const record = value as Record<string, unknown>;
    return {
        summary: typeof record.summary === 'string' && record.summary.trim().length > 0 ? record.summary : defaultCharacterState.summary,
        mood: typeof record.mood === 'string' && record.mood.trim().length > 0 ? record.mood : defaultCharacterState.mood,
        disposition:
            typeof record.disposition === 'string' && record.disposition.trim().length > 0
                ? record.disposition
                : defaultCharacterState.disposition,
        grudges: stringList(record.grudges),
        attachments: stringList(record.attachments),
        updatedAtMs: typeof record.updatedAtMs === 'number' && Number.isFinite(record.updatedAtMs) ? record.updatedAtMs : 0,
    };
};

export const createPersonalityService = (
    memory: MemoryService,
): PersonalityService => {
    const isProfileId = (value: string): value is PersonalityProfileId =>
        profileById.has(value as PersonalityProfileId);

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
        getCharacterState: async (options) => {
            for (const key of scopedKeys(options)) {
                const stored = await memory.getSelfState(key);
                if (stored) return normalizeCharacterState(stored);
            }
            return defaultCharacterState;
        },
        setCharacterState: async (state, options) => {
            const current = normalizeCharacterState(await memory.getSelfState(writeKey(options)));
            const merged: CharacterState = {
                ...current,
                ...state,
                grudges: state.grudges ?? current.grudges,
                attachments: state.attachments ?? current.attachments,
                updatedAtMs: Date.now(),
            };
            await memory.setSelfState(writeKey(options), 'character', merged, options);
            return merged;
        },
    };
};
