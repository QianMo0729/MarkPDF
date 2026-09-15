import { useEffect, useState } from "react";
import { thumbnailForDeck } from "./thumbnails";

interface Props {
  deckId: string;
  pageIndex: number;
  width: number;
  height: number;
  radius?: number;
  /** Contain (default) keeps the whole page visible inside slide-bg padding. */
  fit?: "contain" | "cover";
}

/** Small page preview used by list rows and deck cards; renders on demand and caches to disk. */
export function DeckThumbnail({ deckId, pageIndex, width, height, radius = 4, fit = "contain" }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    thumbnailForDeck(deckId, pageIndex)
      .then((u) => alive && setUrl(u))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [deckId, pageIndex]);

  return (
    <span
      className="deck-thumb"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height,
        flex: `0 0 ${width}px`,
        background: "var(--slide-bg)",
        border: "1px solid var(--border)",
        borderRadius: radius,
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      {url && (
        <img
          src={url}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }}
          draggable={false}
        />
      )}
    </span>
  );
}
