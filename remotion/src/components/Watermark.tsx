import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND_GOLD } from "../lib/colors";

export const Watermark: React.FC = () => {
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Top-left brand */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          fontFamily: "Montserrat, sans-serif",
          fontSize: 18,
          fontWeight: 800,
          color: BRAND_GOLD,
          opacity: 0.7,
          letterSpacing: "0.15em",
          backgroundColor: "rgba(0,0,0,0.4)",
          padding: "4px 10px",
          borderRadius: 4,
        }}
      >
        COLD VAULT
      </div>

      {/* Bottom-right handle */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          fontFamily: "Montserrat, sans-serif",
          fontSize: 16,
          fontWeight: 600,
          color: "rgba(255,255,255,0.3)",
        }}
      >
        @ColdVaultYT
      </div>
    </AbsoluteFill>
  );
};
