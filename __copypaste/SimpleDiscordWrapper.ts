// import { joinVoiceChannel } from "@discordjs/voice";
// import { Client, Events, GatewayIntentBits, type VoiceBasedChannel } from "discord.js";
// import { textAgent } from "../agents";
// import type { UserInfo } from "../types";

import { Client, Events, GatewayIntentBits, GuildMember, Message, VoiceChannel } from "discord.js";
import { Scope, Effect, Console, Exit, Stream, Context } from "effect"


interface DiscordInterface {
    
  // some apis might take in other effects, and then transform them with Effect.map perhaps
  // e.g. an addServiceCharge() function that takes in any effect at all, as long as the S value is a number or whatever.
}
class Discord extends Context.Tag("DiscordService")<Discord, DiscordInterface>() {};

// const guild = bot.guilds.cache.get(process.env.GUILD_ID!)!;


// const getVoiceChannels = () => {
//     const channels = guild?.channels.cache
//         .filter((channel) => channel.isVoiceBased)
//         .map((g) => g as VoiceBasedChannel);
//     return channels;
// };

// const getUserVoiceChannel = (id: string) => {
//     return getVoiceChannels()?.find((channel) =>
//         channel.members.has(id)
//     )
// }

// type EventType = 'test' | 'asdf';

// const pipeEvents = (emit: (event: EventType, Ctx<>) => void) => {
//     bot.on(Events.MessageCreate, async (message) => {
//         emit('message', )
//     //     console.log('works');
//     //     // connection.on(VoiceConnectionStatus.Ready, (oldState, newState) => {
//     //     //     console.log('Connection is in the Ready state!');
//     //     // });
//     //     // player.on(AudioPlayerStatus.Playing, (oldState, newState) => {
//     //     //     console.log('Audio player is in the Playing state!');
//     //     // });

//     //     // CTX is critical - I think that lives on the runner.
//     //     // But then for certain tools it's like specific to a user and things.        
        
//     //     // grab details about the user of this here message
//     //     if (message.author.bot) return;
//     //     const voiceChannel = getUserVoiceChannel(message.author.id);

//     //     // HELL YEAH - up to date context injected right in there!
//     //     const userInfo: UserInfo =  {
//     //         isInVoice: voiceChannel != undefined
//     //     }
        
//     //     // const result = await brainRunner.run(textAgent, thread.concat({ role: 'user', content: message.content}));
//     //     // result.history;

//     //     console.log(result);
        
//     //     if(voiceChannel) {
//     //         joinVoiceChannel({ guildId: guild.id, channelId: voiceChannel.id, adapterCreator: guild?.voiceAdapterCreator});
//     //     }
//     });
// } 

// export type EventMap = {
//   ready:   { ts: number; client: Client };
//   message: { ts: number; guildId?: string; message: Message; isInVoice: boolean };
//   voiceJoin: { ts: number; guildId: string; member: GuildMember; channel: VoiceChannel };
//   error:   { ts: number; error: unknown };
// };
// export type EventType = keyof EventMap;
// type Handler<K extends EventType> = (payload: EventMap[K]) => void;

// const bus = makeBus<EventMap>();

// /** 3) Functional API surface */
// export const on   = bus.on;
// export const once = bus.once;
// export const off  = bus.off;

// ------------------ usage (keep wherever you bootstrap) ------------------
// const discord = new DiscordWrapper(process.env.DISCORD_TOKEN!);
//
// // OPTION A: per-event handlers (cleanest)
// const offMsg = discord.on("message", ({ message, isInVoice }) => {
//   if (isInVoice) {
//     // do voice-aware logic
//   }
//   if (message.content.startsWith("!ping")) message.reply("pong");
// });
//
// const offVj = discord.on("voiceJoin", ({ member, channel }) => {
//   console.log(`${member.user.username} joined ${channel.name}`);
// });
//
// // OPTION B: single switch (still typed)
// const offAll = [
//   discord.on("ready", (e) => handle({ type: "ready", ...e })),
//   discord.on("message", (e) => handle({ type: "message", ...e })),
//   discord.on("voiceJoin", (e) => handle({ type: "voiceJoin", ...e })),
// ];
//
// type Event = { [K in EventType]: { type: K } & EventMap[K] }[EventType];
// function handle(e: Event) {
//   switch (e.type) {
//     case "ready":
//       console.log("Bot ready");
//       break;
//     case "message":
//       e.message.content; // typed
//       break;
//     case "voiceJoin":
//       e.channel.id; // typed
//       break;
//   }
// }


/** 4) Start/stop just (un)wire Discord to the bus */
let client: Client | null = null;

export async function startDiscordBot(token?: string) {
    if(!token) token = process.env.DISCORD_TOKEN;
    if(!token) throw new Error("You need a token!");
    
  if (client) return; // idempotent
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  client.once(Events.ClientReady, () => {
    bus.emit("ready", { ts: Date.now(), client: client! });
  });

  client.on(Events.MessageCreate, (message) => {
    try {
      if (message.author.bot) return;
      const guildId = message.guild?.id;
      const isInVoice = !!getUserVoiceChannelId(message.client, message.author.id);
      bus.emit("message", { ts: Date.now(), guildId, message, isInVoice });
    } catch (error) {
      bus.emit("error", { ts: Date.now(), error });
    }
  });

  client.on(Events.VoiceStateUpdate, (_oldS, newS) => {
    try {
      const member = newS.member;
      const channel = newS.channel;
      if (member && channel && channel.isVoiceBased()) {
        bus.emit("voiceJoin", {
          ts: Date.now(),
          guildId: channel.guild.id,
          member,
          channel: channel as VoiceChannel,
        });
      }
    } catch (error) {
      bus.emit("error", { ts: Date.now(), error });
    }
  });

  client.on("error", (error) => bus.emit("error", { ts: Date.now(), error }));

  await client.login(token);
  return client;
}

export async function stopDiscord() {
  if (!client) return;
  await client.destroy();
  client = null;
}

/** 5) Tiny helper (internal) */
function getUserVoiceChannelId(client: Client, userId: string): string | undefined {
  for (const [, guild] of client.guilds.cache) {
    const vs = guild.voiceStates.cache.get(userId);
    if (vs?.channelId) return vs.channelId;
  }
  return undefined;
}
