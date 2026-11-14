import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useScrollArea } from "../ui/OverlayScroll";
import { isPinnedToBottom } from "./stick-to-bottom";
import { workScrollSnapshots } from "./view-mode";

/**
 * Scroll-anchor hook for `WorkView`:
 * - First open of a session lands at the bottom once turns exist, and follows streaming growth while pinned.
 * - Switching `Work → CLI → Work` (or switching sessions and coming back) restores the exact `scrollTop`
 *   and `pinned` state from `workScrollSnapshots`, so reading an earlier turn never jumps back to the bottom.
 */
export function useWorkScroll(sessionId: string, itemCount: number) {
  const el = useScrollArea();
  const contentRef = useRef<HTMLDivElement>(null);
  const countRef = useRef(itemCount);
  countRef.current = itemCount;

  const pinnedRef = useRef(true);
  const initializedRef = useRef(false);
  const guardJumpRef = useRef(false);
  const frameRef = useRef(0);

  const releaseGuardNextFrame = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      guardJumpRef.current = false;
    });
  }, []);

  const jumpToBottom = useCallback(
    (box: HTMLDivElement) => {
      guardJumpRef.current = true;
      box.scrollTop = box.scrollHeight;
      pinnedRef.current = true;
      workScrollSnapshots.set(sessionId, {
        scrollTop: box.scrollTop,
        pinned: true,
      });
      releaseGuardNextFrame();
    },
    [sessionId, releaseGuardNextFrame],
  );

  // Reset per-session initialization flag when sessionId changes.
  useLayoutEffect(() => {
    initializedRef.current = false;
    const saved = workScrollSnapshots.get(sessionId);
    pinnedRef.current = saved ? saved.pinned : true;
  }, [sessionId]);

  useLayoutEffect(() => {
    if (!el) return;
    if (!initializedRef.current) {
      const saved = workScrollSnapshots.get(sessionId);
      if (saved) {
        initializedRef.current = true;
        pinnedRef.current = saved.pinned;
        guardJumpRef.current = true;
        el.scrollTop = saved.pinned ? el.scrollHeight : saved.scrollTop;
        releaseGuardNextFrame();
        return;
      }
      if (itemCount > 0) {
        initializedRef.current = true;
        jumpToBottom(el);
      }
      return;
    }
    if (pinnedRef.current) {
      jumpToBottom(el);
    }
  }, [el, sessionId, itemCount, jumpToBottom, releaseGuardNextFrame]);

  useEffect(() => {
    if (!el) return;
    const onScroll = () => {
      if (guardJumpRef.current) {
        guardJumpRef.current = false;
        return;
      }
      const pinned = isPinnedToBottom(el);
      pinnedRef.current = pinned;
      workScrollSnapshots.set(sessionId, {
        scrollTop: el.scrollTop,
        pinned,
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      if (!initializedRef.current) {
        if (countRef.current > 0) {
          initializedRef.current = true;
          jumpToBottom(el);
        }
        return;
      }
      if (pinnedRef.current) {
        jumpToBottom(el);
      }
    });
    observer.observe(el);
    if (contentRef.current) observer.observe(contentRef.current);

    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
      cancelAnimationFrame(frameRef.current);
    };
  }, [el, sessionId, jumpToBottom]);

  return contentRef;
}
