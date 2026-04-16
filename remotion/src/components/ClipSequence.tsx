import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Sequence,
} from "remotion";

type Clip = { url: string; start: number; duration: number };

export const ClipSequence: React.FC<{
  clips: Clip[];
  outroStart: number | null;
}> = ({ clips, outroStart }) => {
  const { fps } = useVideoConfig();

  // Find the last non-outro clip index
  const lastRealClipIdx =
    outroStart !== null
      ? clips.findIndex((c) => c.start >= outroStart) - 1
      : clips.length - 1;

  return (
    <AbsoluteFill>
      {clips.map((clip, i) => {
        const startFrame = Math.round(clip.start * fps);
        const durationFrames = Math.round(clip.duration * fps);
        const isOutroClip = outroStart !== null && clip.start >= outroStart;
        const isLastRealClip = i === lastRealClipIdx && outroStart !== null;

        if (isOutroClip) {
          // Pure black frame — no footage
          return (
            <Sequence
              key={i}
              from={startFrame}
              durationInFrames={durationFrames}
            >
              <AbsoluteFill style={{ backgroundColor: "#000" }} />
            </Sequence>
          );
        }

        return (
          <Sequence key={i} from={startFrame} durationInFrames={durationFrames}>
            <ClipWithKenBurns
              url={clip.url}
              durationFrames={durationFrames}
              fadeToBlack={isLastRealClip}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const ClipWithKenBurns: React.FC<{
  url: string;
  durationFrames: number;
  fadeToBlack?: boolean;
}> = ({ url, durationFrames, fadeToBlack }) => {
  const frame = useCurrentFrame();

  // Ken Burns: slow zoom from 100% to 112%
  const scale = interpolate(frame, [0, durationFrames], [1.0, 1.12], {
    extrapolateRight: "clamp",
  });

  // Fade to black in the last 1.5 seconds of this clip
  const fadeFrames = 45; // 1.5s at 30fps
  const fadeStart = Math.max(0, durationFrames - fadeFrames);
  const blackOverlay = fadeToBlack
    ? interpolate(frame, [fadeStart, durationFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <OffthreadVideo
        muted
        src={url}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          filter: "saturate(0.85) contrast(1.1)",
        }}
      />
      {fadeToBlack && (
        <AbsoluteFill
          style={{
            backgroundColor: `rgba(0,0,0,${blackOverlay})`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
