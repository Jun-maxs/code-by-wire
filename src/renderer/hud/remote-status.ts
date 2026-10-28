import { createContext, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Main's answer to `hud_remote_status` (main/hud/remote-status.ts). */
export interface RemoteStatus {
  installed: boolean;
  online: boolean;
  hub: string | null;
  heartbeatAt: number | null;
}

/** Whether the phone can reach this PC (the HAPI runner is up); null until first read. */
export const RemoteStatusContext = createContext<RemoteStatus | null>(null);

const POLL_MS = 20_000;

export function useRemoteStatus(): RemoteStatus | null {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void invoke<RemoteStatus>("hud_remote_status")
        .then((s) => live && setStatus(s))
        .catch(() => {});
    read();
    const t = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return status;
}
