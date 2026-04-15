import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { BRAND_GOLD } from "../lib/colors";

export const LowerThird: React.FC<{
  playerName: string;
  storyType: string;
}> = ({ playerName, storyType }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  // Fade in after 3 seconds
  const opacity = interpolate(currentTime, [3, 3.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Slide up slightly
  const translateY = interpolate(currentTime, [3, 3.5], [10, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const storyLabel = storyType.replace(/_/g, " ").toUpperCase();

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: "8%",
          left: "5%",
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      >
        {/* Story type eyebrow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              width: 20,
              height: 1,
              backgroundColor: BRAND_GOLD,
            }}
          />
          <span
            style={{
              fontFamily: "Montserrat, sans-serif",
              fontSize: 18,
              fontWeight: 700,
              color: BRAND_GOLD,
              letterSpacing: "0.2em",
            }}
          >
            {storyLabel}
          </span>
        </div>

        {/* Player name */}
        <div
          style={{
            fontFamily: "Montserrat, sans-serif",
            fontSize: 36,
            fontWeight: 900,
            color: "#fff",
            textShadow: "0 2px 12px rgba(0,0,0,1)",
          }}
        >
          {playerName.toUpperCase()}
        </div>
      </div>
    </AbsoluteFill>
  );
};
