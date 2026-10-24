/** A small "?" that reveals a plain-language explanation on hover or keyboard focus. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip" tabIndex={0} role="note" aria-label={text}>
      <span aria-hidden="true">?</span>
      <span className="info-tip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
