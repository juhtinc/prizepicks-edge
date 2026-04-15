import React from "react";
import { Composition } from "remotion";
import { SportsLoreShort } from "./SportsLoreShort";

export type VideoProps = {
  clips: Array<{ url: string; start: number; duration: number }>;
  voiceoverUrl: string | null;
  musicUrl: string | null;
  captions: Array<{
    text: string;
    start: number;
    duration: number;
    color?: string;
  }>;
  playerName: string;
  storyType?: string;
  duration: number;
  outroStart: number | null;
};

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="SportsLoreShort"
        component={SportsLoreShort}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={30 * 59}
        defaultProps={{
          clips: [],
          voiceoverUrl: null,
          musicUrl: null,
          captions: [],
          playerName: "PLAYER NAME",
          storyType: "forgotten_legend",
          duration: 59,
          outroStart: null,
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.ceil(props.duration * 30),
        })}
      />
    </>
  );
};
