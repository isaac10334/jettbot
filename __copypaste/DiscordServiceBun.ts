// DiscordLive.ts
import { Context, Effect, Layer, Stream, Queue, Ref, Config, Scope, Console, Brand, Chunk } from "effect"
import {
  Client as DClient,
  GatewayIntentBits,
  Partials,
  type Interaction as DInteraction,
  type Message as DMessage,
  Events as DEvents,
  type CacheType as DCacheType,
  type TextBasedChannel,
  VoiceConnectionStates,
} from "discord.js"
import { VoiceState } from "discord.js"
import { Discord, VoiceChannelId } from "./DiscordService"
import {
  ChannelId,
  GuildId,
  UserId,
  type DiscordServiceShape,
  type Message,
  type SendText,
  MessageId,
  type VoiceJoin,
  type VoiceLeave
} from "./DiscordService"
import { ja } from "zod/v4/locales"
import { addFinalizer } from "effect/Scope"
import { createAudioPlayer, entersState, joinVoiceChannel, NoSubscriberBehavior, VoiceConnection, VoiceConnectionStatus } from "@discordjs/voice"

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMembers
] 

// const toMsg = (m: DMessage): Message => ({
//   id: sf(m.id) as MessageId,
//   channelId: sf(m.channelId) as ChannelId,
//   guildId: m.guildId ? (sf(m.guildId) as GuildId) : undefined,
//   authorId: sf(m.author.id) as UserId,
//   content: m.content ?? "",
//   createdAt: m.createdTimestamp ?? Date.now(),
// })

const service = Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(
    Effect.gen(function*() {
      const token = yield* Config.string("DISCORD_TOKEN");
      if(!token) yield* Effect.fail("No token.");

      const client = new DClient({intents});
      yield* Effect.promise(async () => await client.login(token));
      return client;
    }),
    (c) => {
      Console.log("Killing client now.")
      return Effect.promise(async() => await c.destroy())
    }
  )
  // Idea: Use Bun's amazing TOML support for nice TOML based config
  const guildId = yield* Config.string("GUILD_ID");
  yield* Console.log(guildId);

  const guild = yield* Effect.promise(async () => client.guilds.cache.get(guildId)!);
  if(!guild) yield* Effect.fail("Guild not found.");

  
  
  // const thing = Stream.async((emit) => {
  //   connection.
  // });

  return {
    client,
    // Text ops
    sendText: ({ channelId, content, replyTo}: SendText) => Effect.promise(async () => {
    }),
    editMessage: (_c: ChannelId, _m: MessageId, _s: string) => Effect.promise(async () => {}),
    deleteMessage: (_c: ChannelId, _m: MessageId) => Effect.promise(async () => {}),
    // Fetchers
    fetchMessage: (_c: ChannelId, _m: MessageId) => Effect.promise(async () => {
      const channel = await guild?.channels.fetch(_c);

      if(!channel) return Effect.fail("Couldn't find the channel.");

      if(!channel?.isTextBased) return Effect.fail("Not a text channel.");

      const dmessage = (channel as TextBasedChannel).messages.cache.get(_m);
      if(!dmessage) return Effect.fail("Couldn't find the message.");

      const msg: Message = {
        id: _m,
        channelId: _c,
        guildId: GuildId(dmessage.id),
        authorId: UserId(dmessage.author.id),  
        content: dmessage.content,
        createdAt: dmessage.createdAt
      }

      return Effect.succeed(msg);
    }),
    fetchChannel: (_c: ChannelId | VoiceChannelId) => Effect.promise(async() => {
      // Wtf is this nasty line
      const { id } = (await (await guild!.fetch()!).channels.fetch(_c)!)!;
      return {
        channelId: id,
        guildId: guild!.id!
      }
    }),
    fetchUserName: (_u: UserId) => Effect.promise(async() => Promise.resolve("asdf")),
    messages: Stream.async<Message>((emit) => {
      client.on(DEvents.MessageCreate, (message: DMessage) => {
        const {
          id,
        channelId,
        guildId,
        author,
        content,
        createdAt,
        } = message;
        const msg: Message = {
          id: MessageId(id), 
          channelId: ChannelId(channelId),
          guildId: GuildId(guildId!),
          authorId: UserId(author.id),
          content, 
          createdAt
        };
        emit(
          Effect.succeed(Chunk.of(msg))
        )
      })
    }),
    interactions: Stream.async<DInteraction>((emit) => {
      client.on(DEvents.InteractionCreate, (interaction: DInteraction<DCacheType>) => {

      })
    }),
    voiceJoins: Stream.async<VoiceJoin>((emit) => {
      
    }),
    voiceLeaves: Stream.async<VoiceLeave>((emit) => {
      client.on(DEvents.VoiceStateUpdate, (oldState, newState) => {
      })
    }),
    errors: Stream.async<Error>((emit) => {
      client.on(DEvents.Error, (error) => {
        emit(Effect.succeed(Chunk.of(error)));
      });
    }),
    getUserVoiceChannel: (_u: UserId, _g: GuildId) => Effect.succeed<ChannelId | undefined>(undefined),
    onInteractionCommand: (_name: string) => Stream.async((emit) => {
      // emit(Interaction)
    }),
    shutdown: Effect.sync(() => { /* noop */ }),
    joinVoiceChannel: (_c: VoiceChannelId) => Effect.gen(function* () {
      const voiceChannel = yield* Effect.promise(async () => await guild?.channels.fetch('1150310214139138170'));
      if(!voiceChannel) yield* Effect.fail("No voice channel.");
      const connection = yield* Effect.acquireRelease(
        Effect.gen(function* () {
          const conn = joinVoiceChannel({guildId, channelId: voiceChannel!.id!, adapterCreator: guild.voiceAdapterCreator})
          yield* Effect.promise(() =>
            entersState(conn, VoiceConnectionStatus.Ready, 15_000)
          );
          const player = createAudioPlayer({
            behaviors: { noSubscriber: NoSubscriberBehavior.Play }
          });
          conn.subscribe(player);
          // Reconnect logic — Discord can bounce you during moves/RTC churn
          conn.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
              await Promise.race([
                entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
                entersState(conn, VoiceConnectionStatus.Connecting, 5_000)
              ]);
              // If either transition happens, we’re still good. Otherwise:
            } catch {
              console.log("Failure");
              conn.destroy();
            }
          });
          conn.on(VoiceConnectionStatus.Destroyed, () => {
            // you might clean up your player, refs, etc.
          })
          return conn;
        }), (conn: VoiceConnection) => Effect.sync(() => conn.destroy()));
        return Stream.async((emit) => {
          connection.on()
        
        });
    })
  }
})

export class DiscordBun extends Effect.Service<Discord>()("DiscordService", {scoped: service}) {}
