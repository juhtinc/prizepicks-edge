import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { BRAND_GOLD } from "../lib/colors";

export const OutroCard: React.FC<{
  outroStart: number;
  playerName: string;
}> = ({ outroStart, playerName }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const currentTime = frame / fps;

  if (currentTime < outroStart) return null;

  const outroFrame = frame - Math.round(outroStart * fps);
  const totalOutroFrames = durationInFrames - Math.round(outroStart * fps);

  // Player name springs in
  const nameSpring = spring({
    frame: outroFrame,
    fps,
    config: { damping: 15, stiffness: 80, mass: 0.8 },
  });
  const nameTranslateY = interpolate(nameSpring, [0, 1], [30, 0]);
  const nameOpacity = interpolate(outroFrame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Gold line wipes in at 40% through
  const lineProgress = interpolate(outroFrame, [18, 36], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // SPORTS LORE fades in at 50%
  const brandOpacity = interpolate(outroFrame, [24, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        zIndex: 90,
      }}
    >
      {/* Ambient gold glow behind center */}
      <div
        style={{
          position: "absolute",
          top: "35%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "60%",
          height: "40%",
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse, rgba(200,140,40,0.12) 0%, transparent 70%)",
          filter: "blur(40px)",
          opacity: nameOpacity,
        }}
      />

      {/* Player name — with strong text shadow for readability */}
      <div
        style={{
          position: "absolute",
          top: "25%",
          left: "50%",
          transform: `translate(-50%, -50%) translateY(${nameTranslateY}px)`,
          fontFamily: "Montserrat, sans-serif",
          fontWeight: 900,
          fontSize: 64,
          color: BRAND_GOLD,
          letterSpacing: "0.02em",
          textShadow:
            "0 0 40px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,1), 0 2px 4px rgba(0,0,0,1), 0 0 60px rgba(212,146,15,0.15)",
          textAlign: "center",
          opacity: nameOpacity,
          whiteSpace: "nowrap",
          WebkitTextStroke: "1px rgba(0,0,0,0.3)",
          paintOrder: "stroke fill" as any,
        }}
      >
        {playerName.toUpperCase()}
      </div>

      {/* Gold accent line */}
      <div
        style={{
          position: "absolute",
          top: "58%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 200 * lineProgress,
          height: 1,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(245,166,35,0.15) 15%, rgba(245,166,35,0.5) 50%, rgba(245,166,35,0.15) 85%, transparent 100%)",
        }}
      />

      {/* SPORTS LORE wordmark — with shadow for readability */}
      <div
        style={{
          position: "absolute",
          top: "62%",
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: "Montserrat, sans-serif",
          fontWeight: 800,
          fontSize: 22,
          color: BRAND_GOLD,
          opacity: brandOpacity * 0.5,
          letterSpacing: "0.35em",
          textShadow:
            "0 0 20px rgba(0,0,0,1), 0 0 10px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,1)",
        }}
      >
        SPORTS LORE
      </div>
    </AbsoluteFill>
  );
};
