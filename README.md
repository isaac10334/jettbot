# jettbot

Goal: A realtime Discord bot that evolves AI voice bots beyond the simple "user speaks, AI responds" default. Jettbot can interject and interrupt, or stay quiet on purpose. Jettbot needs to be able to thrive in large calls with 6+ people. The entire architecture is modular and extendable, based on a powerful actor system developed here. Text to speech (TTS) is done per-user for great quality and implicit diarization. This necessitates a step to merge incoming transcripts in realtime and feed it to the bot's brain in a way that allows for high-quality responses. Jettbot is not a professional voice bot. It's more like an uncensored roleplay bot. But the key point here is that Jettbot's personality and voice are configurable, so it can be whatever you want.

```
Discord Receiver
   |
   v (control msgs: voiceJoin/voiceLeave)
┌──────────────────────────────┐
│ VoiceIngressActor            │
│  - spawns UserTrackActor     │
└──────────────┬───────────────┘
               │ owns children
               v
┌──────────────────────────────┐
│ UserTrackActor (per user)    │
│  - opus subscribe            │
│  - decode -> 16k mono        │
│  - jitter buffer             │
│  - publishes:                │
│     dir.provide("userFrames:<uid>", InPort<Pcm16kMonoFrame>) │
└──────────────┬───────────────┘
               │ (InPort published per user)
               v
┌──────────────────────────────┐
│ ModeSupervisorActor          │
│  - owns active composition   │
│  - sets mode: loopback/agent │
└──────────────┬───────────────┘
               │
     ┌─────────┴─────────┐
     │                   │
     v                   v

LOOPBACK MODE:                       AGENT MODE:
┌──────────────────────────────┐    ┌──────────────────────────────┐
│ LoopbackMixerActor           │    │ TranscriptHubActor            │
│  - watches userFrames:*      │    │  - watches sttOut:*           │
│  - mixes (20ms tick)         │    │  - merges transcripts         │
│  - produces mixed audio      │    └──────────────┬───────────────┘
└──────────────┬───────────────┘                   │ InPort<Transcript>
               │ OutPort<MixedPcm48kStereoFrame>    v
               │ (attached to Egress)       ┌────────────────────────┐
               v                            │ BrainActor              │
┌──────────────────────────────┐            │  - consumes transcripts  │
│ EgressActor                  │            │  - emits text chunks     │
│  - owns Discord audio out    │            └──────────┬─────────────┘
│  - consumes mixed pcm        │                       │ InPort<string>
└──────────────────────────────┘                       v
                                            ┌────────────────────────┐
                                            │ TtsActor                │
                                            │  - consumes text chunks  │
                                            │  - produces pcm frames   │
                                            └──────────┬─────────────┘
                                                       │ OutPort<Pcm48kStereo>
                                                       v
                                                  EgressActor

```
