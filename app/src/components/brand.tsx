/**
 * The wordmark. A small mark - a ring with a scan sweep, drawn inline in the accent colour -
 * and the name set in two tones so it reads as a name rather than a word: "Adapter" in the
 * text colour, "scan" in the accent. Left-aligned wherever it appears; the mark shares the
 * text's baseline edge with the nav below it.
 */
export function Brand({ suffix, size = 15 }: { suffix?: string; size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <svg className="wordmark-mark" viewBox="0 0 24 24" width={size + 5} height={size + 5} fill="none" aria-hidden>
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" strokeDasharray="34 20" strokeLinecap="round" transform="rotate(-60 12 12)" />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
      </svg>
      <span className="wordmark-text">Adapter<span className="wordmark-accent">scan</span></span>
      {suffix && <span className="wordmark-suffix">{suffix}</span>}
    </span>
  );
}
