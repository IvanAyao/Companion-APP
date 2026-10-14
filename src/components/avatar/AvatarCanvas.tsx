"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { Character } from "./Character";
import type { AvatarSignals } from "./signals";

/** Frames the character for portrait phones and wider screens alike. */
function ResponsiveCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;
    // Keep the head + shoulders in view; pull back on narrow screens.
    cam.position.set(0, 0.35, aspect < 0.75 ? 8.6 : 7);
    cam.lookAt(0, 0.05, 0);
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

export default function AvatarCanvas({ signals }: { signals: AvatarSignals }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 30, near: 0.1, far: 50, position: [0, 0.35, 7] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      aria-hidden
    >
      <ResponsiveCamera />
      <hemisphereLight args={["#ffffff", "#8a84c9", 1.1]} />
      <directionalLight position={[2.5, 4, 5]} intensity={1.6} color="#fff6ee" />
      <directionalLight position={[-4, 2, -3]} intensity={1.2} color="#a8f0ff" />
      <directionalLight position={[0, -2, 4]} intensity={0.35} color="#ffd6e8" />
      <Character signals={signals} />
    </Canvas>
  );
}
