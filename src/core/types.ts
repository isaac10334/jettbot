export type UserId = string

export interface TranscriptPacket {
  type: 'utterance'
  userId: UserId
  ts: number // ms epoch
  text: string // final transcript
  partial?: string // last partial (optional)
  isFinal: boolean // true when VAD turn ended
  confidence: number // 0..1 ASR confidence

  // Speech analytics (superpowers)
  lang?: string // "en-US", "es-AR", ...
  accent?: string // "US-General", "Scouse", "Indian-English", etc. (model-best guess)
  emotion?: 'neutral' | 'happy' | 'angry' | 'sad' | 'fear' | 'surprise' | 'disgust'
  speakingRateWpm?: number
  avgPitchHz?: number
  snrDb?: number // signal-to-noise estimate
  toxicity?: number // 0..1
  keywords?: string[] // distilled keyphrases
  mentionsBot?: boolean // fast routing hint
  vad?: { startMs: number; endMs: number; durationMs: number }

  // Threading / intent
  topicId?: string // conversation thread id (Conductor can assign)
  intent?: string // "music.request", "game.command", "smalltalk", ...
  meta?: Record<string, unknown>
}
