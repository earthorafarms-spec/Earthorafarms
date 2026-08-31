// Mechanical safety net for TTS/spoken output. The system prompt (prompt.ts)
// tells the model never to use markdown, but LLMs default to bullet/numbered
// lists and **bold** headings out of chat-UI habit, and won't reliably follow
// a prose instruction against that under load — same two-layer pattern as
// output-policy.ts (prompt instruction + mechanical enforcement). Without
// this, Sarvam/OpenAI TTS reads literal asterisks and list markers aloud,
// which is what made early responses sound unnaturally robotic.
export const MAX_SPOKEN_REPLY_CHARS = 240;

export function toSpokenText(text: string): string {
  let out = text;

  // Markdown links: [label](url) -> label
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Headings: leading #'s on a line
  out = out.replace(/^#{1,6}\s+/gm, '');

  // Bold/italic emphasis markers — strip the markers, keep the text.
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  out = out.replace(/\*\*(.+?)\*\*/g, '$1');
  out = out.replace(/__(.+?)__/g, '$1');
  out = out.replace(/\*(.+?)\*/g, '$1');

  // Inline/fenced code markers.
  out = out.replace(/`{1,3}([^`]*)`{1,3}/g, '$1');

  // List markers at the start of a line ("1. ", "- ", "* ", "• ").
  out = out.replace(/^\s*(?:\d+[.)]|[-*•])\s+/gm, '');

  // Line breaks read as unnatural pauses in TTS — collapse to sentence-like
  // separators instead of silently concatenating words together.
  out = out.replace(/\n{2,}/g, '. ');
  out = out.replace(/\n/g, ', ');

  // Tidy up artifacts left by the above: runs of punctuation (e.g. a
  // heading's "." bumping into a following ". " from a collapsed blank
  // line) collapse to just the last mark in the run.
  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/[.,!?](?:\s*[.,!?])+/g, (m) => m.trim().slice(-1));
  out = out.replace(/।\s*[.,]/g, '।');
  out = out.replace(/[.,]\s*।/g, '।');
  out = out.replace(/:\s*,/g, ': ');
  out = out.replace(/ ,/g, ',');
  out = out.replace(/[ \t]+/g, ' ');
  out = out.trim();

  return out;
}

/**
 * A phone reply must be bounded even when the model ignores the prompt's
 * brevity rule. Long catalog paragraphs are the dominant TTS latency source.
 * Keep at most two sentences, then apply a word-safe character ceiling.
 */
export function limitSpokenReply(text: string, maxChars: number = MAX_SPOKEN_REPLY_CHARS): string {
  const clean = text.trim();
  if (!clean) return clean;

  const sentenceMatches = clean.match(/[^.!?।]+[.!?।]?/gu) ?? [clean];
  let bounded = sentenceMatches.slice(0, 2).map((part) => part.trim()).filter(Boolean).join(' ');
  if (bounded.length <= maxChars) return bounded;

  const candidate = bounded.slice(0, maxChars - 1).trimEnd();
  const lastSpace = candidate.lastIndexOf(' ');
  if (lastSpace >= Math.floor(maxChars * 0.6)) bounded = candidate.slice(0, lastSpace);
  else bounded = candidate;
  return `${bounded.replace(/[,:;.!?।\s]+$/u, '')}.`;
}
