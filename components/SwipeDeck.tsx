"use client";

import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { useState } from "react";
import { TokenCard } from "./TokenCard";
import type { ApiToken } from "@/lib/types";

const SWIPE_THRESHOLD = 120;

export function SwipeDeck({
  tokens,
  onSwipe,
  onEmpty,
}: {
  tokens: ApiToken[];
  onSwipe: (token: ApiToken, action: "like" | "dislike") => void;
  onEmpty?: () => void;
}) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const visible = tokens.filter((t) => !removed.has(t.mint)).slice(0, 3);

  function commit(token: ApiToken, action: "like" | "dislike") {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.add(token.mint);
      if (next.size === tokens.length) onEmpty?.();
      return next;
    });
    onSwipe(token, action);
  }

  if (!visible.length) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-white/50">
        No more tokens. Hit refresh to fetch the latest migrations.
      </div>
    );
  }

  return (
    <div className="relative mx-auto h-[70vh] max-h-[640px] w-full max-w-md select-none">
      {visible
        .slice()
        .reverse()
        .map((token, idx) => {
          const stackIdx = visible.length - 1 - idx;
          const isTop = stackIdx === 0;
          return (
            <SwipeCard
              key={token.mint}
              token={token}
              stackIdx={stackIdx}
              draggable={isTop}
              onCommit={(action) => commit(token, action)}
            />
          );
        })}
      <SwipeButtons
        onLike={() => visible[0] && commit(visible[0], "like")}
        onDislike={() => visible[0] && commit(visible[0], "dislike")}
      />
    </div>
  );
}

function SwipeCard({
  token,
  stackIdx,
  draggable,
  onCommit,
}: {
  token: ApiToken;
  stackIdx: number;
  draggable: boolean;
  onCommit: (action: "like" | "dislike") => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-18, 18]);
  const likeOpacity = useTransform(x, [40, 140], [0, 1]);
  const dislikeOpacity = useTransform(x, [-140, -40], [1, 0]);

  const offset = stackIdx * 8;
  const scale = 1 - stackIdx * 0.04;

  return (
    <motion.div
      className="absolute inset-0 px-4"
      style={{
        x: draggable ? x : 0,
        rotate: draggable ? rotate : 0,
        zIndex: 10 - stackIdx,
      }}
      initial={{ y: offset + 8, scale: scale - 0.02, opacity: 0 }}
      animate={{ y: offset, scale, opacity: 1 }}
      exit={{ x: 0, opacity: 0 }}
      drag={draggable ? "x" : false}
      dragElastic={0.7}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={(_, info) => {
        if (info.offset.x > SWIPE_THRESHOLD) onCommit("like");
        else if (info.offset.x < -SWIPE_THRESHOLD) onCommit("dislike");
      }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <TokenCard token={token} />
      {draggable ? (
        <>
          <motion.div
            style={{ opacity: likeOpacity }}
            className="pointer-events-none absolute left-8 top-10 rotate-[-12deg] rounded-md border-4 border-like px-3 py-1 text-2xl font-extrabold text-like"
          >
            LIKE
          </motion.div>
          <motion.div
            style={{ opacity: dislikeOpacity }}
            className="pointer-events-none absolute right-8 top-10 rotate-[12deg] rounded-md border-4 border-dislike px-3 py-1 text-2xl font-extrabold text-dislike"
          >
            NOPE
          </motion.div>
        </>
      ) : null}
    </motion.div>
  );
}

function SwipeButtons({ onLike, onDislike }: { onLike: () => void; onDislike: () => void }) {
  return (
    <div className="pointer-events-none absolute -bottom-4 left-0 right-0 flex items-center justify-center gap-6">
      <button
        onClick={onDislike}
        className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border border-line bg-card text-2xl text-dislike shadow-lg active:scale-95"
        aria-label="Dislike"
      >
        ✕
      </button>
      <button
        onClick={onLike}
        className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border border-line bg-card text-2xl text-like shadow-lg active:scale-95"
        aria-label="Like"
      >
        ♥
      </button>
    </div>
  );
}

// Re-export AnimatePresence for callers that need transition wrappers.
export { AnimatePresence };
