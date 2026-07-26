// Caption cues transcribed from the clips themselves with whisper.cpp
// (base.en) — see .codex/whisper-models. Generated, not hand-written:
// each entry is { t: seconds into the clip, text: what is said }.
//
// Regenerate after adding clips:
//   ffmpeg -i public/feed/<clip>.mp4 -ar 16000 -ac 1 out.wav
//   whisper-cli -m .codex/whisper-models/ggml-base.en.bin -f out.wav --output-json

export interface CaptionCue { t: number; text: string }

export const CAPTION_CUES: Record<string, CaptionCue[]> = {
  'feed/ad-cartoon.mp4': [
    { t: 0.0, text: '[SPEAKING SPANISH]' },
    { t: 2.0, text: '[SPEAKING SPANISH]' },
    { t: 3.0, text: 'Get Poplar, the discovery system.' },
    { t: 5.0, text: 'Poplar.' },
    { t: 6.08, text: 'But wait, there\'s more.' },
    { t: 7.68, text: 'I love it.' },
    { t: 8.44, text: 'Call now.' },
    { t: 9.12, text: 'Call now.' },
  ],
  'feed/ad-comedy.mp4': [
    { t: 0.0, text: 'Good news, family. I figured out what\'s popular.' },
    { t: 2.5, text: 'Dad, nobody has said "good news" family since 1988.' },
    { t: 5.0, text: 'According to my research...' },
    { t: 6.5, text: 'Poplar, foodually.' },
    { t: 7.5, text: 'Poplar, take this poplar future.' },
  ],
  'feed/ad-food.mp4': [
    { t: 0.0, text: 'is this still popular it was popular last week stop settling for stale culture' },
    { t: 5.04, text: 'popular serves up what\'s popular fresh food trends fitness trends beauty' },
    { t: 9.26, text: 'boards popular' },
  ],
  'feed/ad-french.mp4': [
    { t: 0.0, text: '(upbeat music)' },
    { t: 6.72, text: 'We\'ll be right back after this short break.' },
  ],
  'feed/ad-kids.mp4': [
    { t: 0.0, text: '(bell ringing)' },
    { t: 0.82, text: '- What\'s everyone talking about today?' },
    { t: 2.48, text: 'Food, music, fashion?' },
    { t: 4.76, text: '- Please say tacos.' },
    { t: 5.84, text: 'Did somebody say popular?' },
    { t: 7.24, text: 'Funs, poplar helps you explore what\'s popular.' },
  ],
  'feed/ad-music.mp4': [
    { t: 0.0, text: 'culture moves fast trends don\'t wait they rise they shift they disappear and' },
    { t: 5.96, text: 'most people are always a step behind popular brings what\'s popular into one' },
    { t: 9.6, text: 'place' },
  ],
  'feed/ad-shopping.mp4': [
    { t: 0.0, text: 'Tired of missing out?' },
    { t: 1.36, text: 'There\'s too much noise!' },
    { t: 2.88, text: 'Get poplar the Discovery System!' },
    { t: 4.56, text: 'It makes popular simple!' },
    { t: 6.0, text: 'But wait, there\'s more!' },
    { t: 7.52, text: 'I love it!' },
    { t: 8.4, text: 'Call now! Call now!' },
  ],
  'feed/ad-spanish-1.mp4': [
    { t: 0.0, text: 'Poplar eznéon, es por adiversion, geno de colores, poplar ez oro, itambien es frillo.' },
  ],
  'feed/ad-spanish-2.mp4': [
    { t: 0.0, text: 'We\'ll be right back after this short break.' },
    { t: 9.2, text: 'Connecta!' },
  ],
  'feed/ad-spanish-3.mp4': [
    { t: 0.0, text: '(upbeat music)' },
    { t: 6.72, text: 'We\'ll be right back after this short break.' },
  ],
  'feed/ad-sports.mp4': [
    { t: 0.0, text: 'culture moves fast trends don\'t wait they rise they shift they disappear and' },
    { t: 5.96, text: 'most people are always a step explore the things people are talkular into one' },
    { t: 9.6, text: 'place' },
  ],
}
