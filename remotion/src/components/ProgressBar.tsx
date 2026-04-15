import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND_GOLD_BRIGHT } from "../lib/colors";

export const ProgressBar: React.FC<{ totalDuration: number }> = ({
  totalDuration,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = frame / (totalDuration * fps);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Background track */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 6,
          backgroundColor: "rgba(255,255,255,0.06)",
        }}
      />
      {/* Fill bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: 6,
          width: `${Math.min(progress * 100, 100)}%`,
          backgroundColor: BRAND_GOLD_BRIGHT,
        }}
      />
    </AbsoluteFill>
  );
};
