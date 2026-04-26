export type BotStatus = 'idle' | 'connecting' | 'connected' | 'running' | 'stopped';

export type ClientTrackState = {
    readonly userId: string;
    readonly jitterFrames: number;
    readonly primed: boolean;
    readonly opusPacketsPerSecond: number;
    readonly pcmFramesPerSecond: number;
    readonly biggestOpusGapMs: number;
    readonly resubscribeCount: number;
    readonly stallCount: number;
};

export type ClientState = {
    readonly status: BotStatus;
    readonly loopbackMode: string;
    readonly outputFramesPerSecond: number;
    readonly trackCount: number;
    readonly tracks: ReadonlyArray<ClientTrackState>;
};

export type ExternalState = {
    readonly guildId: string;
    readonly voiceChannelId: string;
    readonly connectedMemberIds: ReadonlyArray<string>;
};

export type BotState = {
    readonly client: ClientState;
    readonly external: ExternalState;
};

export type BotStateStore = ReturnType<typeof createBotStateStore>;

export const createBotStateStore = (initial: ExternalState) => {
    let state: BotState = {
        client: {
            status: 'idle',
            loopbackMode: 'mix_all',
            outputFramesPerSecond: 0,
            trackCount: 0,
            tracks: [],
        },
        external: initial,
    };

    return {
        getSnapshot(): BotState {
            return state;
        },
        updateClient(next: Partial<ClientState>) {
            state = {
                ...state,
                client: {
                    ...state.client,
                    ...next,
                },
            };
        },
        updateExternal(next: Partial<ExternalState>) {
            state = {
                ...state,
                external: {
                    ...state.external,
                    ...next,
                },
            };
        },
    };
};
