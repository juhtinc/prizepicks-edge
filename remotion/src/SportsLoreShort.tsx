import React from "react";
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from "remotion";
import { VideoProps } from "./Root";
import { ClipSequence } from "./components/ClipSequence";
import { FlashTransition } from "./components/FlashTransition";
import { Vignette } from "./components/Vignette";
import { BottomGradient } from "./components/BottomGradient";
import { CaptionOverlay } from "./components/CaptionOverlay";
import { LowerThird } from "./components/LowerThird";
import { Watermark } from "./components/Watermark";
import { ProgressBar } from "./components/ProgressBar";
import { OutroCard } from "./components/OutroCard";

export const SportsLoreShort: React.FC<VideoProps> = ({
  clips,
  voiceoverUrl,
  musicUrl,
  captions,
  playerName,
  storyType,
  duration,
  outroStart,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const isOutro = outroStart !== null && currentTime >= outroStart;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Layer 1: Video clips */}
      <ClipSequence clips={clips} outroStart={outroStart} />

      {/* Layer 2: Flash transitions between clips */}
      {!isOutro && <FlashTransition clips={clips} />}

      {/* Layer 3: Vignette overlay */}
      {!isOutro && <Vignette />}

      {/* Layer 4: Bottom gradient for text readability */}
      {!isOutro && <BottomGradient />}

      {/* Layer 5: Lower third (player name + story type) */}
      {!isOutro && (
        <LowerThird playerName={playerName} storyType={storyType || ""} />
      )}

      {/* Layer 6: Watermark */}
      {!isOutro && <Watermark />}

      {/* Layer 7: Progress bar */}
      <ProgressBar totalDuration={duration} />

      {/* Layer 8: Outro card */}
      {outroStart !== null && (
        <OutroCard outroStart={outroStart} playerName={playerName} />
      )}

      {/* Layer 9: Captions — on top of everything including outro */}
      <CaptionOverlay captions={captions} outroStart={outroStart} />

      {/* Audio: Voiceover */}
      {voiceoverUrl && <Audio src={voiceoverUrl} volume={1.0} />}

      {/* Audio: Background music */}
      {musicUrl && (
        <Audio
          src={musicUrl}
          volume={(f) =>
            // Fade in over 3 seconds, then stay at 10%
            Math.min(f / (30 * 3), 1) * 0.1
          }
        />
      )}
    </AbsoluteFill>
  );
};
