import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  interpolate,
} from "remotion";
import { getWordColor } from "../lib/colors";

type Caption = {
  text: string;
  start: number;
  duration: number;
  color?: string;
};

export const CaptionOverlay: React.FC<{ captions: Caption[] }> = ({
  captions,
}) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 95 }}>
      {captions.map((cap, i) => {
        const startFrame = Math.round(cap.start * fps);
        const durationFrames = Math.max(Math.round(cap.duration * fps), 1);

        return (
          <Sequence key={i} from={startFrame} durationInFrames={durationFrames}>
            <CaptionGroup text={cap.text} durationFrames={durationFrames} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const CaptionGroup: React.FC<{
  text: string;
  durationFrames: number;
}> = ({ text, durationFrames }) => {
  const frame = useCurrentFrame();
  const words = text.split(/\s+/);

  // Fade in over first 4 frames
  const opacity = interpolate(frame, [0, 4], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        top: "42%",
        transform: "translateY(-50%)",
        height: "auto",
        opacity,
      }}
    >
      <div
        style={{
          width: "70%",
          textAlign: "center",
          fontFamily: "Montserrat, sans-serif",
          fontWeight: 800,
          fontSize: 48,
          lineHeight: 1.35,
          textShadow:
            "0 0 16px rgba(0,0,0,1), 0 2px 8px rgba(0,0,0,0.9), 0 4px 16px rgba(0,0,0,0.6)",
          WebkitTextStroke: "2px rgba(0,0,0,0.5)",
          paintOrder: "stroke fill" as any,
        }}
      >
        {words.map((word, wi) => (
          <span key={wi} style={{ color: getWordColor(word) }}>
            {word}
            {wi < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
