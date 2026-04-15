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

  return (
    <AbsoluteFill>
      {clips.map((clip, i) => {
        const startFrame = Math.round(clip.start * fps);
        const durationFrames = Math.round(clip.duration * fps);
        const isOutroClip = outroStart !== null && clip.start >= outroStart;

        return (
          <Sequence key={i} from={startFrame} durationInFrames={durationFrames}>
            <ClipWithKenBurns
              url={clip.url}
              durationFrames={durationFrames}
              isOutro={isOutroClip}
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
  isOutro?: boolean;
}> = ({ url, durationFrames, isOutro }) => {
  const frame = useCurrentFrame();

  // Ken Burns: slow zoom from 100% to 112%
  const scale = interpolate(frame, [0, durationFrames], [1.0, 1.12], {
    extrapolateRight: "clamp",
  });

  // Outro: darken with overlay (no CSS blur — too heavy for Chrome Headless)
  const darkenOpacity = isOutro
    ? interpolate(frame, [0, 15], [0, 0.85], { extrapolateRight: "clamp" })
    : 0;

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
      }}
    >
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
      {isOutro && (
        <AbsoluteFill
          style={{
            backgroundColor: `rgba(0,0,0,${darkenOpacity})`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
