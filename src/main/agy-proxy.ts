/**
 * agy talks to Google through its own Go HTTP stack, which ignores the Windows system proxy and only
 * honours HTTP(S)_PROXY. Where Google is reachable only through a proxy, an agy started without those
 * variables fails to sign in or loses its turns. So its sessions start with the proxy the system is
 * set to — the same variables the user's own `Antigravity-proxy.cmd` launcher sets — unless the
 * environment already names one.
 */

const NO_PROXY = "localhost,127.0.0.1,::1";

/** The first usable proxy in a PAC-style answer ("PROXY 127.0.0.1:17891; DIRECT") as a proxy URL, or
 *  null when the answer is DIRECT or names nothing usable. */
export function proxyUrlFromPac(answer: string): string | null {
  for (const part of answer.split(";")) {
    const m = /^\s*(PROXY|HTTPS|SOCKS5|SOCKS)\s+(\S+)\s*$/i.exec(part);
    if (!m) continue;
    const scheme = m[1].toUpperCase();
    if (scheme === "SOCKS5" || scheme === "SOCKS") return `socks5://${m[2]}`;
    return `${scheme === "HTTPS" ? "https" : "http"}://${m[2]}`;
  }
  return null;
}

/** The variables to start agy with, or undefined when the environment already sets a proxy or the
 *  system has none. */
export function agyProxyEnv(
  proxyUrl: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  if (env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy)
    return undefined;
  if (!proxyUrl) return undefined;
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    NO_PROXY: env.NO_PROXY || env.no_proxy || NO_PROXY,
  };
}

/** Keeps the system proxy for agy's endpoint current: asked once up front (create it at startup — the
 *  lookup is async, so a helper made at the first spawn would answer that spawn with nothing) and again
 *  on every read, so a proxy switched on or off later reaches the next session. */
export function createAgyProxy(deps: {
  resolve: (url: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
}): { env(): Record<string, string> | undefined } {
  let proxyUrl: string | null = null;
  const refresh = (): void => {
    deps
      .resolve("https://cloudcode-pa.googleapis.com/")
      .then((answer) => {
        proxyUrl = proxyUrlFromPac(answer);
      })
      .catch(() => {
        // Keep the last answer; a failed lookup isn't a reason to drop a working proxy.
      });
  };
  refresh();
  return {
    env: () => {
      const out = agyProxyEnv(proxyUrl, deps.env);
      refresh();
      return out;
    },
  };
}
