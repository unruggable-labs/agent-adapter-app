/**
 * The wordmark: the name, lowercase, in the product's monospace face, one colour. No mark, no
 * device. It sits on the nav's left edge and looks like it belongs with the hashes below it.
 */
export function Brand({ suffix }: { suffix?: string }) {
  return (
    <span className="wordmark">
      adapterscan
      {suffix && <span className="wordmark-suffix">/{suffix.toLowerCase()}</span>}
    </span>
  );
}
