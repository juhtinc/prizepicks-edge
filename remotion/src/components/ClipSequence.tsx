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

  // Outro: blur and darken over the first 15 frames (~0.5s)
  const blurAmount = isOutro
    ? interpolate(frame, [0, 15], [0, 12], { extrapolateRight: "clamp" })
    : 0;
  const darkenAmount = isOutro
    ? interpolate(frame, [0, 15], [1, 0.2], { extrapolateRight: "clamp" })
    : 1;
  const saturation = isOutro
    ? interpolate(frame, [0, 15], [0.85, 0.2], { extrapolateRight: "clamp" })
    : 0.85;

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
          filter: `saturate(${saturation}) contrast(1.1) blur(${blurAmount}px) brightness(${darkenAmount})`,
        }}
      />
    </AbsoluteFill>
  );
};
