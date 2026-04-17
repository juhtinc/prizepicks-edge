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

export const CaptionOverlay: React.FC<{
  captions: Caption[];
  outroStart?: number | null;
}> = ({ captions, outroStart }) => {
  const { fps, durationInFrames } = useVideoConfig();

  // During the outro, merge all remaining captions into one full sentence
  let processedCaptions = captions;
  if (outroStart !== null && outroStart !== undefined) {
    const beforeOutro = captions.filter(
      (c) => c.start + c.duration <= outroStart,
    );
    const duringOutro = captions.filter(
      (c) => c.start + c.duration > outroStart,
    );

    if (duringOutro.length > 0) {
      const fullText = duringOutro.map((c) => c.text).join(" ");

      // Isolate the final question: last sentence ending in "?".
      // If it has a lead-in before an em-dash (e.g. "So ask yourself —"),
      // strip that so only the question itself shows over the outro card.
      let outroText = fullText;
      const sentences = fullText.split(/(?<=[.!?])\s+/);
      const lastQuestion = [...sentences]
        .reverse()
        .find((s) => s.trim().endsWith("?"));
      if (lastQuestion) {
        outroText = lastQuestion.includes("—")
          ? lastQuestion.split("—").slice(1).join("—").trim()
          : lastQuestion.trim();
      }

      const outroCaption: Caption = {
        text: outroText,
        start: duringOutro[0].start,
        duration:
          duringOutro[duringOutro.length - 1].start +
          duringOutro[duringOutro.length - 1].duration -
          duringOutro[0].start +
          2, // extend 2s to hold on screen
        color: "white",
      };
      processedCaptions = [...beforeOutro, outroCaption];
    }
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 95 }}>
      {processedCaptions.map((cap, i) => {
        const startFrame = Math.round(cap.start * fps);
        const durationFrames = Math.min(
          Math.max(Math.round(cap.duration * fps), 1),
          durationInFrames - startFrame,
        );
        const isOutroCap =
          outroStart !== null &&
          outroStart !== undefined &&
          cap.start >= outroStart - 1;

        return (
          <Sequence key={i} from={startFrame} durationInFrames={durationFrames}>
            <CaptionGroup
              text={cap.text}
              durationFrames={durationFrames}
              isOutro={isOutroCap}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const CaptionGroup: React.FC<{
  text: string;
  durationFrames: number;
  isOutro?: boolean;
}> = ({ text, durationFrames, isOutro }) => {
  const frame = useCurrentFrame();
  const words = text.split(/\s+/);

  // Fade in over first 4 frames
  const opacity = interpolate(frame, [0, 4], [0, 1], {
    extrapolateRight: "clamp",
  });

  // During outro, use slightly smaller font if text is long
  const fontSize = isOutro && words.length > 8 ? 36 : 48;

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
          width: isOutro ? "80%" : "70%",
          textAlign: "center",
          fontFamily: "Montserrat, sans-serif",
          fontWeight: 800,
          fontSize,
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
