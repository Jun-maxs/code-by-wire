import type { CSSProperties, MutableRefObject } from "react";
import { useContext } from "react";
import { RemoteStatusContext } from "../../../../remote-status";
import { BotMark } from "../BotMark";
import HUDGlow, { type GlowAlert } from "../HUDGlow";
import { botState, facingFromEdge, isAttention } from "../bots/bot-state";
import { DockMemory, type Direction } from "../bots/mark-director";
import { labelWidth, type HUDRect, type stripMetrics } from "../geometry";
import {
  meterLabel,
  statusColor,
  vendorKey,
  type HUDConfig,
  type HUDEdge,
  type HUDVendor,
} from "../model";
import { Silhouette } from "./NotchSurface";
import type { HUDNativePointer } from "../HUDScene";
import { useFormat } from "@agent-hud/ui/format-context";
import { quotaPercent, quotaDisplayLabel } from "@agent-hud/ui/format";
import { useMarkLevelText } from "../ground";

const horizontal = (edge: HUDEdge) => edge === "top" || edge === "bottom";

/** How far the edge glow fades out past each end of the marks. */
const GLOW_FADE = 16;

export function HUDMarkStrip({
  id,
  config,
  edge,
  strip,
  metrics,
  vendors,
  glowColors,
  glowAlert,
  glowHidden,
  cardVisible,
  detached,
  light,
  fill,
  outline,
  marginStyle,
  dragVisual,
  hovered,
  pinned: _pinned,
  pointerInside,
  open,
  sender,
  focusedVendor,
  botDirections,
  dockMemory,
  nativePointer,
  reduceMotion,
  hasAlert,
  suppressHover,
  setHovered,
  setPinned: _setPinned,
  forceOpen,
  pin,
}: {
  id: string;
  config: HUDConfig;
  edge: HUDEdge;
  strip: HUDRect;
  metrics: ReturnType<typeof stripMetrics>;
  vendors: HUDVendor[];
  glowColors: string[];
  glowAlert?: GlowAlert | null;
  glowHidden: boolean;
  cardVisible: boolean;
  detached: boolean;
  light: boolean;
  fill: string;
  outline: string;
  marginStyle: CSSProperties;
  dragVisual: boolean;
  hovered: string | null;
  pinned: boolean;
  pointerInside: boolean;
  open: boolean;
  sender?: { source: string };
  focusedVendor?: HUDVendor;
  botDirections?: Record<string, Direction>;
  dockMemory: MutableRefObject<DockMemory>;
  nativePointer?: HUDNativePointer;
  reduceMotion: boolean;
  hasAlert: boolean;
  suppressHover: MutableRefObject<boolean>;
  setHovered: (key: string | null) => void;
  setPinned: (pinned: boolean) => void;
  forceOpen: () => void;
  pin: (key?: string) => void;
}) {
  const format = useFormat();
  const { quotaDisplay } = format;
  const zh = format.language === "zh";
  // A ring's figure is text: on a see-through ground, its level's see-through shade.
  const figureColor = useMarkLevelText(light);
  // ScreenHUD.surface: a Dynamic backdrop is a flat lip, clipped to the marks' column.
  const backdropOverhang = config.glowRange + config.glowBlur * 3 + 200;
  const backdropReach =
    config.glowStyle === "blur"
      ? config.glowRange + config.glowBlur * 3
      : (config.glowGridCore + config.glowGridFade + 1) * config.glowGridPitch;
  // The glow is drawn for a top dock and turned to the edge so its agent
  // colours stay in mark order: left to right on a bottom dock (a vertical
  // flip, not a half turn), top to bottom on the side docks (Open
  // GlowWindowController's canvas orientation).
  const backdropTransform =
    edge === "bottom"
      ? `matrix(1,0,0,-1,0,${strip.height})`
      : edge === "left"
        ? "matrix(0,1,1,0,0,0)"
        : edge === "right"
          ? `matrix(0,1,-1,0,${strip.width},0)`
          : undefined;

  return (
    <>
      {config.mode === "logos" && !glowHidden && (!cardVisible || detached) && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            // Code-by-wire: the lip fades out past the marks' ends instead of stopping in a hard
            // edge, which read as a coloured block on a light desktop.
            inset: horizontal(edge)
              ? `-${backdropReach}px -${GLOW_FADE}px`
              : `-${GLOW_FADE}px -${backdropReach}px`,
            pointerEvents: "none",
            maskImage: `linear-gradient(${horizontal(edge) ? "to right" : "to bottom"}, transparent, #000 ${GLOW_FADE * 2}px, #000 calc(100% - ${GLOW_FADE * 2}px), transparent)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: horizontal(edge) ? GLOW_FADE : backdropReach,
              top: horizontal(edge) ? backdropReach : GLOW_FADE,
              transformOrigin: "0 0",
              transform: backdropTransform,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: -backdropOverhang,
                top: -2,
              }}
            >
              <HUDGlow
                outwardOnly={config.glowOutwardOnly}
                style={config.glowStyle}
                effect={config.glowEffect}
                width={
                  (horizontal(edge) ? strip.width : strip.height) +
                  backdropOverhang * 2
                }
                height={2}
                radius={0}
                attached
                colors={glowColors}
                alert={glowAlert}
                active={vendors.some((v) => v.working > 0)}
                period={
                  vendors.some((v) => v.working > 0)
                    ? config.breathSeconds
                    : config.idleBreathSeconds
                }
                amplitude={config.breathAmplitude}
                brightness={config.glowBrightness}
                range={config.glowRange}
                blur={config.glowBlur}
                pitch={config.glowGridPitch}
                core={config.glowGridCore}
                fade={config.glowGridFade}
                density={config.glowGridDensity}
                reduceMotion={reduceMotion}
              />
            </div>
          </div>
        </div>
      )}
      {config.mode === "notch" ? (
        <div
          className="hud-classic-silhouette"
          aria-label={zh ? "悬停展开 Agent HUD" : "Hover to expand Agent HUD"}
          tabIndex={0}
          role="button"
          aria-describedby={`hud-instructions-${id}`}
          onFocus={() => {
            if (!hasAlert && !suppressHover.current) forceOpen();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") forceOpen();
          }}
          style={{
            position: "absolute",
            left: -8,
            top: 0,
            width: strip.width + 16,
            height: strip.height,
            cursor: dragVisual ? "grabbing" : "default",
          }}
        >
          {config.hasNotch && cardVisible && light && (
            <Silhouette
              width={strip.width + 16}
              height={strip.height}
              edge="top"
              flare={8}
              radius={metrics.radius}
              fill={config.hasNotch ? "#000" : fill}
              outline={outline}
            />
          )}
        </div>
      ) : (
        <div
          className="hud-mark-strip"
          style={{
            position: "relative",
            display: "flex",
            flexDirection: horizontal(edge) ? "row" : "column",
            alignItems: horizontal(edge) ? "center" : "flex-start",
            justifyContent: "flex-start",
            gap: metrics.gap,
            ...(config.mode === "simple"
              ? {
                  ...marginStyle,
                  width: metrics.width - (horizontal(edge) ? 0 : 3),
                  height: metrics.height - (horizontal(edge) ? 3 : 0),
                  paddingTop: metrics.padding.top,
                  paddingRight: metrics.padding.right,
                  paddingBottom: metrics.padding.bottom,
                  paddingLeft: metrics.padding.left,
                  borderRadius: metrics.radius,
                  background: !cardVisible || detached ? fill : "transparent",
                  border: 0,
                  boxShadow:
                    !cardVisible || detached
                      ? `inset 0 0 0 1px ${outline}`
                      : undefined,
                  backdropFilter: undefined,
                }
              : {
                  width: strip.width,
                  height: strip.height,
                  alignItems: "center",
                  justifyContent: "center",
                }),
          }}
        >
          <RemoteDot edge={edge} light={light} gap={metrics.gap} />
          {vendors.map((vendor, index) => (
            <button
              key={vendor.key}
              type="button"
              className="hud-agent-mark"
              aria-label={`${vendor.name}, ${meterLabel(vendor, quotaDisplay)} ${vendor.used == null ? "" : quotaDisplayLabel(quotaDisplay, format.language)}${vendor.working ? `, ${vendor.working} running` : ""}`}
              onPointerEnter={() => {
                if (hovered !== vendor.key) {
                  setHovered(vendor.key);
                }
              }}
              onFocus={() => {
                setHovered(vendor.key);
                if (!hasAlert && !suppressHover.current) forceOpen();
              }}
              onClick={() => pin(vendor.key)}
              style={{
                position: "relative",
                zIndex: 1,
                border: 0,
                padding: 0,
                color: "inherit",
                background: "transparent",
                display: "flex",
                alignItems: "center",
                gap: metrics.labelGap,
                flexShrink: 0,
                cursor: dragVisual
                  ? "grabbing"
                  : config.separatesAgents
                    ? "pointer"
                    : "default",
                visibility:
                  config.mode === "logos" && !config.showsLogos
                    ? "hidden"
                    : "visible",
              }}
            >
              <span
                style={{
                  width: metrics.mark,
                  height: metrics.mark,
                  display: "inline-grid",
                  placeItems: "center",
                  position: "relative",
                  // Code-by-wire: logos float on the desktop with no ground; a faint dark rim keeps a
                  // white mark readable on a light wallpaper and vanishes on a dark one.
                  filter:
                    config.mode === "logos"
                      ? "drop-shadow(0 0 0.6px rgba(0,0,0,0.6)) drop-shadow(0 1px 2px rgba(0,0,0,0.22))"
                      : undefined,
                }}
              >
                {config.mode === "simple" && config.showsRings && (
                  <svg
                    viewBox={`0 0 ${metrics.mark} ${metrics.mark}`}
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      inset: 0,
                      overflow: "visible",
                    }}
                  >
                    <circle
                      cx={metrics.mark / 2}
                      cy={metrics.mark / 2}
                      r={(metrics.mark - config.ringWidth) / 2}
                      fill="none"
                      stroke={light ? "#0000000f" : "#ffffff1a"}
                      strokeWidth={config.ringWidth}
                    />
                    <circle
                      cx={metrics.mark / 2}
                      cy={metrics.mark / 2}
                      r={(metrics.mark - config.ringWidth) / 2}
                      fill="none"
                      stroke={
                        (quotaPercent(vendor.used, quotaDisplay) ?? 0) <= 0
                          ? "transparent"
                          : statusColor(vendor.level)
                      }
                      strokeWidth={config.ringWidth}
                      strokeLinecap="round"
                      pathLength={100}
                      strokeDasharray={`${quotaPercent(vendor.used, quotaDisplay) ?? 0} 100`}
                      transform={`rotate(-90 ${metrics.mark / 2} ${metrics.mark / 2})`}
                    />
                  </svg>
                )}
                <BotMark
                  source={vendor.name}
                  size={metrics.logo}
                  light={light}
                  enabled={config.botLogos}
                  hovered={
                    ((hovered === vendor.key && pointerInside) ||
                      (open &&
                        !sender &&
                        (!focusedVendor ||
                          focusedVendor.key === vendor.key))) &&
                    !dragVisual
                  }
                  state={(() => {
                    const state =
                      botDirections?.[vendor.key]?.state ??
                      botState({
                        look:
                          vendor.waiting > 0
                            ? "permission"
                            : vendor.working > 0
                              ? "plain"
                              : "idle",
                      });
                    const facesCard = sender
                      ? vendorKey(sender.source) === vendor.key
                      : open &&
                        (!focusedVendor || focusedVendor.key === vendor.key);
                    return {
                      ...state,
                      facing:
                        isAttention(state.look) && facesCard
                          ? facingFromEdge(edge)
                          : null,
                    };
                  })()}
                  cue={(() => {
                    const direction = botDirections?.[vendor.key];
                    return direction
                      ? dockMemory.current.cue(
                          vendor.key,
                          direction.cue,
                          direction.state.badge,
                          performance.now() / 1000,
                        )
                      : null;
                  })()}
                  staysBot={false}
                  aim={
                    nativePointer?.point
                      ? (() => {
                          const centerX =
                            strip.x +
                            (horizontal(edge)
                              ? metrics.centers[index]
                              : metrics.padding.left + metrics.mark / 2);
                          const centerY =
                            strip.y +
                            (horizontal(edge)
                              ? metrics.padding.top + metrics.mark / 2
                              : metrics.centers[index]);
                          const dx = nativePointer.point!.x - centerX,
                            dy = nativePointer.point!.y - centerY,
                            distance = Math.hypot(dx, dy);
                          return distance < 1
                            ? ([0, 0] as const)
                            : ([
                                dx / (distance + 120),
                                dy / (distance + 120),
                              ] as const);
                        })()
                      : undefined
                  }
                />
                {vendor.waiting > 0 && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      right: -2,
                      bottom: -2,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#e9a16d",
                      boxShadow: `0 0 0 2px ${light ? "#f8f8fa" : "#000"}`,
                    }}
                  />
                )}
              </span>
              {config.mode === "simple" && config.showsNumbers && (
                <span
                  style={{
                    color: figureColor(vendor.level),
                    fontSize: metrics.font,
                    fontWeight: 400,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    textAlign: "right",
                    minWidth: horizontal(edge)
                      ? undefined
                      : Math.max(
                          ...vendors.map((v) =>
                            labelWidth(
                              meterLabel(v, quotaDisplay),
                              metrics.font,
                            ),
                          ),
                        ),
                  }}
                >
                  {meterLabel(vendor, quotaDisplay)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Code-by-wire: a small lamp in the strip's corner saying whether the phone can reach this PC (the
 *  HAPI runner is up). Absent when HAPI isn't set up here. Takes no layout space. */
function RemoteDot({
  edge,
  light,
  gap,
}: {
  edge: HUDEdge;
  light: boolean;
  gap: number;
}) {
  const status = useContext(RemoteStatusContext);
  if (!status?.installed) return null;
  const zh = navigator.language.startsWith("zh");
  const host = status.hub?.replace(/^https?:\/\//, "") ?? "";
  const title = status.online
    ? `${zh ? "手机遥控在线" : "Phone remote online"}${host ? ` · ${host}` : ""}`
    : zh
      ? "手机遥控离线（runner 没在跑）"
      : "Phone remote offline (runner not running)";
  // Past the last mark, on the strip's axis, so it never sits on a logo.
  const place: CSSProperties = horizontal(edge)
    ? { left: `calc(100% + ${Math.max(4, gap / 2)}px)`, top: "50%", transform: "translateY(-50%)" }
    : { top: `calc(100% + ${Math.max(4, gap / 2)}px)`, left: "50%", transform: "translateX(-50%)" };
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      style={{
        position: "absolute",
        ...place,
        zIndex: 2,
        width: 7,
        height: 7,
        borderRadius: 999,
        pointerEvents: "none",
        background: status.online ? "#46c57a" : light ? "#ffffffcc" : "#000000aa",
        boxShadow: status.online
          ? "0 0 0 1.5px rgba(0,0,0,0.45), 0 0 6px #46c57a"
          : `inset 0 0 0 1.5px ${light ? "#0007" : "#fff8"}`,
      }}
    />
  );
}
