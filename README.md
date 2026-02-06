# jettbot

TODO:

- [ ] Figure out details about the DiscordJS & OpenAI Realtime API, and how to fit them together elegantly, e.g. abstracting away ridiculous audio conversion problems.

```
sDiscord Receiver
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
