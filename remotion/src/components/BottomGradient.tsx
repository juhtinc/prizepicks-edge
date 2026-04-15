import React from "react";
import { AbsoluteFill } from "remotion";

export const BottomGradient: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.9) 100%)",
        pointerEvents: "none",
      }}
    />
  );
};
