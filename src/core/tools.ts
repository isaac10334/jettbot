export const reportUtteranceTool = {
  name: 'report_utterance',
  description: 'Report finalized utterance with analytics',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      confidence: { type: 'number' },
      lang: { type: 'string' },
      accent: { type: 'string' },
      emotion: {
        type: 'string',
        enum: ['neutral', 'happy', 'angry', 'sad', 'fear', 'surprise', 'disgust'],
      },
      speakingRateWpm: { type: 'number' },
      avgPitchHz: { type: 'number' },
      snrDb: { type: 'number' },
      toxicity: { type: 'number' },
      keywords: { type: 'array', items: { type: 'string' } },
      mentionsBot: { type: 'boolean' },
      intent: { type: 'string' },
    },
    required: ['text', 'confidence'],
  },
} as const
