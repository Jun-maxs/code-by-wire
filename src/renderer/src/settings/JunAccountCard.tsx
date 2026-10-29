import { useEffect, useRef, useState } from "react";
import type { JunAccountStatus } from "@shared/jun-account";
import { Card } from "../shell/page-primitives";
import { useI18n } from "../i18n";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "code"; code: string; expiresAt: number }
  | { kind: "problem"; text: string };

const TEXT = {
  zh: {
    title: "hub 账号",
    signedOutLine: "未登录",
    signedOutDesc: "登录后提示词等数据按账号保存，手机 Jun-App 上也能用",
    signIn: "用 hub 账号登录",
    signOut: "退出",
    starting: "正在获取验证码…",
    howTo:
      "在浏览器打开 hub.yuanhk.top 并登录，页面会弹出这个验证码，核对一致后点「批准登录」。",
    waiting: (s: number) =>
      `等待批准 · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} 后过期`,
    openHub: "打开 hub",
    cancel: "取消",
    denied: "这次登录被拒绝了。",
    expired: "验证码已过期。",
    offline: "连不上账号服务，检查网络后重试。",
    retry: "重新获取",
  },
  en: {
    title: "Hub account",
    signedOutLine: "Signed out",
    signedOutDesc:
      "Sign in to keep prompts and the like with your account, shared with Jun-App on the phone",
    signIn: "Sign in with hub account",
    signOut: "Sign out",
    starting: "Getting a code…",
    howTo:
      "Open hub.yuanhk.top in a browser and sign in. The page pops up this code; approve it if it matches.",
    waiting: (s: number) =>
      `Waiting for approval · expires in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
    openHub: "Open hub",
    cancel: "Cancel",
    denied: "This sign-in was denied.",
    expired: "The code expired.",
    offline: "Can't reach the account service. Check the network and retry.",
    retry: "Get a new code",
  },
};

const btn =
  "shrink-0 rounded-md border border-ink-700 px-2.5 py-1 text-meta text-fg hover:bg-ink-800 disabled:opacity-50";

/**
 * Settings → Appearance (fork feature, 2026-10-30): sign in to the hub account the phone app uses.
 * The code shows here; approving it on hub.yuanhk.top finishes the sign-in. While the code is up
 * the card polls main every 2 s (main stays request/response).
 */
export function JunAccountCard({
  onChange,
}: {
  onChange?: (s: JunAccountStatus) => void;
}) {
  const { locale } = useI18n();
  const L = locale === "zh" ? TEXT.zh : TEXT.en;
  const [status, setStatus] = useState<JunAccountStatus | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    void window.api.junAccountStatus().then(setStatus);
  }, []);

  useEffect(() => {
    if (phase.kind !== "code") return;
    let stopped = false;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      void window.api.junAccountPollLogin().then((r) => {
        if (stopped) return;
        if (r.status === "approved") {
          setStatus(r.account);
          onChangeRef.current?.(r.account);
          setPhase({ kind: "idle" });
        } else if (r.status === "denied") {
          setPhase({ kind: "problem", text: L.denied });
        } else if (r.status === "expired" || r.status === "idle") {
          setPhase({ kind: "problem", text: L.expired });
        }
        // "offline" / "pending": keep the code up and try again next tick.
      });
    }, 2000);
    return () => {
      stopped = true;
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [phase.kind]);

  if (!status) return null;

  const start = () => {
    setPhase({ kind: "starting" });
    window.api.junAccountStartLogin().then(
      (s) => setPhase({ kind: "code", code: s.code, expiresAt: s.expiresAt }),
      () => setPhase({ kind: "problem", text: L.offline }),
    );
  };
  const cancel = () => {
    void window.api.junAccountCancelLogin();
    setPhase({ kind: "idle" });
  };
  const signOut = () => {
    void window.api.junAccountSignOut().then((s) => {
      setStatus(s);
      onChangeRef.current?.(s);
    });
  };

  return (
    <Card title={L.title}>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-body text-fg">
            {status.signedIn
              ? [status.user, status.space].filter(Boolean).join(" · ")
              : L.signedOutLine}
          </div>
          <div className="mt-0.5 truncate text-meta text-fg-faint">
            {status.signedIn ? status.device : L.signedOutDesc}
          </div>
        </div>
        {status.signedIn ? (
          <button type="button" className={btn} onClick={signOut}>
            {L.signOut}
          </button>
        ) : (
          phase.kind === "idle" && (
            <button type="button" className={btn} onClick={start}>
              {L.signIn}
            </button>
          )
        )}
      </div>
      {phase.kind === "starting" && (
        <div className="border-t border-ink-850 px-4 py-3 text-meta text-fg-faint">
          {L.starting}
        </div>
      )}
      {phase.kind === "code" && (
        <div className="flex flex-col gap-3 border-t border-ink-850 px-4 py-4">
          <div className="text-meta text-fg-muted">{L.howTo}</div>
          <div className="rounded-lg bg-well py-4 text-center font-mono text-display font-semibold tracking-[0.3em] text-fg">
            {phase.code.slice(0, 3)} {phase.code.slice(3)}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-meta text-fg-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {L.waiting(
                Math.max(0, Math.round((phase.expiresAt - now) / 1000)),
              )}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                className={btn}
                onClick={() =>
                  void window.api.openExternal("https://hub.yuanhk.top/")
                }
              >
                {L.openHub}
              </button>
              <button type="button" className={btn} onClick={cancel}>
                {L.cancel}
              </button>
            </span>
          </div>
        </div>
      )}
      {phase.kind === "problem" && (
        <div className="flex items-center justify-between gap-3 border-t border-ink-850 px-4 py-3">
          <span className="text-meta text-danger">{phase.text}</span>
          <button type="button" className={btn} onClick={start}>
            {L.retry}
          </button>
        </div>
      )}
    </Card>
  );
}
