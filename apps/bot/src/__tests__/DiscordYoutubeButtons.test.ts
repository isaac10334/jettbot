import { describe, expect, test } from "bun:test";
import { __discordVoiceCommandPolicyTestUtils } from "../discord/installDiscordVoiceCommandPolicy";

const createRuntime = () => {
  const calls: string[] = [];
  return {
    calls,
    runtime: {
      env: {
        youtubePlayback: {
          skip: async () => {
            calls.push("skip");
          },
          cancelAll: async () => {
            calls.push("cancelAll");
          },
          state: {
            get: () => ({ current: undefined, queue: [], lastError: undefined, uiMessage: undefined }),
          },
        },
      },
    },
  };
};

const createInteraction = (customId: string) => {
  const calls: string[] = [];
  return {
    calls,
    interaction: {
      customId,
      deferUpdate: async () => {
        calls.push("deferUpdate");
      },
      editReply: async () => {
        calls.push("editReply");
      },
    },
  };
};

describe("YouTube playback buttons", () => {
  test("maps yt:skip to playback skip", async () => {
    const { runtime, calls } = createRuntime();
    const { interaction } = createInteraction("yt:skip");

    await __discordVoiceCommandPolicyTestUtils.handleYoutubeButton(runtime as any, interaction as any);

    expect(calls).toEqual(["skip"]);
  });

  test("maps yt:stop to cancelAll", async () => {
    const { runtime, calls } = createRuntime();
    const { interaction } = createInteraction("yt:stop");

    await __discordVoiceCommandPolicyTestUtils.handleYoutubeButton(runtime as any, interaction as any);

    expect(calls).toEqual(["cancelAll"]);
  });

  test("ignores unknown button custom ids", async () => {
    const { runtime, calls } = createRuntime();
    const { interaction, calls: interactionCalls } = createInteraction("img:next:session");

    await __discordVoiceCommandPolicyTestUtils.handleYoutubeButton(runtime as any, interaction as any);

    expect(calls).toEqual([]);
    expect(interactionCalls).toEqual([]);
    expect(__discordVoiceCommandPolicyTestUtils.parseYoutubeCustomId("img:next:session")).toBeUndefined();
  });
});
