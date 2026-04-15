import React from "react";
import { AbsoluteFill } from "remotion";

export const Vignette: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse at 50% 40%, transparent 30%, rgba(0,0,0,0.7) 100%)",
        pointerEvents: "none",
      }}
    />
  );
};
