import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";

type Clip = { url: string; start: number; duration: number };

export const FlashTransition: React.FC<{ clips: Clip[] }> = ({ clips }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  // Find if we're in a flash window (0.06s before any clip boundary)
  let flashOpacity = 0;
  for (let i = 1; i < clips.length; i++) {
    const boundaryTime = clips[i].start;
    const flashStart = boundaryTime - 0.06;
    const flashEnd = boundaryTime + 0.06;

    if (currentTime >= flashStart && currentTime <= flashEnd) {
      // Peak at boundary, fade out
      const distFromCenter = Math.abs(currentTime - boundaryTime);
      flashOpacity = interpolate(distFromCenter, [0, 0.06], [0.15, 0], {
        extrapolateRight: "clamp",
      });
      break;
    }
  }

  if (flashOpacity <= 0) return null;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: `rgba(255,255,255,${flashOpacity})`,
        pointerEvents: "none",
      }}
    />
  );
};
