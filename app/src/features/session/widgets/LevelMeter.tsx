import { useEffect, useRef, useState } from "react";

const BARS = 24;

/** 24 bars, RMS dB mapped from −50…0 to 0…1, peak bar in accent (docs/SPEC.md 6.5.13). */
export function LevelMeter({ db }: { db: number }) {
  const [peak, setPeak] = useState(0);
  const decay = useRef<number | null>(null);
  const lit = Math.round(Math.max(0, Math.min(1, (db + 50) / 50)) * BARS);

  useEffect(() => {
    if (lit >= peak) {
      setPeak(lit);
      if (decay.current) window.clearTimeout(decay.current);
      decay.current = window.setTimeout(() => setPeak(0), 600);
    }
  }, [lit, peak]);

  return (
    <div className="level-meter" aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className={`level-bar ${i < lit ? "on" : ""} ${i === peak - 1 && peak > lit ? "peak" : ""}`} />
      ))}
    </div>
  );
}
