// Shared play/pause/step controls (Roadmap V3 Phase 1, backlog item 4).
// The five slice browser mains each duplicated the same button row wired to a private
// setInterval. Here the buttons are dumb and delegate to a SimTransport (the hub's
// FixedTickTransport satisfies it structurally). Theme-agnostic: semantic classNames only.

export interface SimTransport {
  readonly playing: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  step(): void;
}

export function TransportControls({
  transport,
  onReset,
  tickRateMs,
}: {
  transport: SimTransport;
  onReset?: () => void;
  tickRateMs?: number;
}) {
  return (
    <div className="steelx-controls">
      <button onClick={() => transport.toggle()}>{transport.playing ? '⏸ pause' : '▶ play'}</button>
      <button onClick={() => transport.step()} disabled={transport.playing}>
        step +1
      </button>
      {onReset !== undefined && <button onClick={onReset}>reset</button>}
      {tickRateMs !== undefined && (
        <span className="steelx-tickrate">
          1 tick / {tickRateMs} ms
        </span>
      )}
    </div>
  );
}
