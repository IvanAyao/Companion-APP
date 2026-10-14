"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AvatarSignals } from "./signals";
import type { Expression } from "@/lib/realtime/types";
import { CLOSED_MOUTH, smoothMouth, type MouthShape } from "@/lib/audio/lipsync";

/**
 * "Nova" — a stylised, friendly 3D character built entirely from primitives
 * (no external model files), so it loads instantly on mobile.
 *
 * Everything animates procedurally from AvatarSignals each frame:
 *  - idle: breathing, gentle sway, random blinks, eye saccades, pointer gaze
 *  - listening / hearing: ears perk, lean in, eyes widen, nod with your voice
 *  - thinking: glance up, asymmetric brows
 *  - speaking: audio-driven mouth (open / wide / round), brow + head motion
 *  - expressions: smile/frown curve, brows, eye squint, blush
 */

const HEAD_R = 1;

const PALETTE = {
  skin: "#b2a8ff",
  skinDeep: "#9d95f5",
  earInner: "#ffb4cb",
  sclera: "#fbfbff",
  iris: "#2f8f93",
  pupil: "#121226",
  brow: "#4b3f8f",
  mouth: "#3b1730",
  tongue: "#ff7f9e",
  teeth: "#ffffff",
  cheek: "#ff8fb1",
  body: "#ece9ff",
  glow: "#6ff2e3",
};

interface ExprTarget {
  smile: number; // -1 frown .. 1 big smile
  browY: number;
  browTilt: number; // + raises inner ends (worried), - angry
  browAsym: number; // one brow up
  eyeOpen: number; // multiplier
  squint: number; // happy eye squash 0..1
  blush: number;
  gazeX: number;
  gazeY: number;
}

const EXPRESSIONS: Record<Expression, ExprTarget> = {
  neutral: { smile: 0.35, browY: 0, browTilt: 0, browAsym: 0, eyeOpen: 1, squint: 0, blush: 0.35, gazeX: 0, gazeY: 0 },
  happy: { smile: 0.95, browY: 0.035, browTilt: 0, browAsym: 0, eyeOpen: 1, squint: 0.3, blush: 0.75, gazeX: 0, gazeY: 0 },
  curious: { smile: 0.25, browY: 0.05, browTilt: 0.05, browAsym: 0.05, eyeOpen: 1.1, squint: 0, blush: 0.35, gazeX: 0, gazeY: 0 },
  thinking: { smile: 0.1, browY: 0.03, browTilt: 0, browAsym: 0.07, eyeOpen: 0.95, squint: 0.1, blush: 0.3, gazeX: 0.45, gazeY: 0.45 },
  concerned: { smile: -0.35, browY: 0.02, browTilt: 0.35, browAsym: 0, eyeOpen: 1, squint: 0, blush: 0.25, gazeX: 0, gazeY: -0.1 },
};

const damp = (cur: number, target: number, rate: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** Point on the head surface (head-local), pushed out by `lift`. */
function onHead(x: number, y: number, lift = 0): [number, number, number] {
  const z = Math.sqrt(Math.max(0, HEAD_R * HEAD_R - x * x - y * y));
  return [x, y, z + lift];
}

// ---------------------------------------------------------------- mouth ----

const MOUTH_SEG = 24; // points per lip edge
const MOUTH_Y = -0.4;

/** A deformable filled mouth polygon conforming to the head surface. */
class MouthGeometry extends THREE.BufferGeometry {
  private pos: Float32Array;
  constructor() {
    super();
    const ring = MOUTH_SEG * 2;
    this.pos = new Float32Array((ring + 1) * 3);
    const idx: number[] = [];
    for (let i = 1; i <= ring; i++) idx.push(0, i, (i % ring) + 1);
    this.setIndex(idx);
    this.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
  }

  /**
   * @param halfW half width
   * @param smile corner curvature (+ up)
   * @param upper upper-lip lift at centre
   * @param lower lower-lip drop at centre
   * @param yOff vertical offset
   */
  update(halfW: number, smile: number, upper: number, lower: number, yOff = 0, lift = 0.012) {
    const p = this.pos;
    const set = (i: number, x: number, y: number) => {
      const [sx, sy, sz] = onHead(x, MOUTH_Y + yOff + y, lift);
      p[i * 3] = sx;
      p[i * 3 + 1] = sy;
      p[i * 3 + 2] = sz;
    };
    set(0, 0, (upper - lower) * 0.5);
    let k = 1;
    for (let i = 0; i < MOUTH_SEG; i++) {
      const u = -1 + (2 * i) / (MOUTH_SEG - 1);
      const curve = smile * 0.09 * u * u; // corners rise when smiling
      const bulge = Math.sqrt(Math.max(0, 1 - u * u));
      set(k++, u * halfW, curve + upper * bulge);
    }
    for (let i = 0; i < MOUTH_SEG; i++) {
      const u = 1 - (2 * i) / (MOUTH_SEG - 1);
      const curve = smile * 0.09 * u * u;
      const bulge = Math.sqrt(Math.max(0, 1 - u * u));
      // Smiles curve the lower lip a little more, like a "D" shape.
      set(k++, u * halfW, curve - lower * bulge - Math.max(0, smile) * 0.035 * bulge);
    }
    (this.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.computeBoundingSphere();
  }
}

// ------------------------------------------------------------------ eye ----

function Eye({ side, groupRef, gazeRef }: {
  side: 1 | -1;
  groupRef: React.RefObject<THREE.Group | null>;
  gazeRef: React.RefObject<THREE.Group | null>;
}) {
  const pos = onHead(0.36 * side, 0.12, -0.1);
  return (
    <group ref={groupRef} position={pos} rotation={[0, 0.12 * side, 0]}>
      <mesh>
        <sphereGeometry args={[0.215, 32, 24]} />
        <meshPhysicalMaterial color={PALETTE.sclera} roughness={0.15} clearcoat={1} clearcoatRoughness={0.1} />
      </mesh>
      <group ref={gazeRef}>
        <mesh position={[0, 0, 0.165]} scale={[1, 1, 0.42]}>
          <sphereGeometry args={[0.135, 32, 24]} />
          <meshStandardMaterial color={PALETTE.iris} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.205]} scale={[1, 1, 0.4]}>
          <sphereGeometry args={[0.072, 24, 16]} />
          <meshStandardMaterial color={PALETTE.pupil} roughness={0.2} />
        </mesh>
        <mesh position={[0.045, 0.055, 0.225]}>
          <sphereGeometry args={[0.03, 12, 8]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh position={[-0.04, -0.045, 0.222]}>
          <sphereGeometry args={[0.013, 10, 8]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>
    </group>
  );
}

// ------------------------------------------------------------ character ----

export function Character({ signals }: { signals: AvatarSignals }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Group>(null);
  const eyeR = useRef<THREE.Group>(null);
  const gazeL = useRef<THREE.Group>(null);
  const gazeR = useRef<THREE.Group>(null);
  const browL = useRef<THREE.Mesh>(null);
  const browR = useRef<THREE.Mesh>(null);
  const earL = useRef<THREE.Group>(null);
  const earR = useRef<THREE.Group>(null);
  const glowMat = useRef<THREE.MeshStandardMaterial>(null);
  const glowLight = useRef<THREE.PointLight>(null);
  const ring = useRef<THREE.Mesh>(null);
  const tongue = useRef<THREE.Mesh>(null);
  const teeth = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);

  const cheekMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: PALETTE.cheek, transparent: true, opacity: 0.2, depthWrite: false }),
    [],
  );
  const mouthGeo = useMemo(() => new MouthGeometry(), []);
  const tongueGeo = useMemo(() => new MouthGeometry(), []);
  const teethGeo = useMemo(() => new MouthGeometry(), []);

  // Animation state that persists across frames (not React state).
  const anim = useRef({
    t: 0,
    expr: { ...EXPRESSIONS.neutral },
    mouth: CLOSED_MOUTH as MouthShape,
    blink: 0, // 0 open, 1 closed
    nextBlink: 1.5,
    blinkStart: -1,
    doubleBlink: false,
    saccade: new THREE.Vector2(),
    nextSaccade: 1,
    lean: 0,
    ear: 0,
    mic: 0,
    prevState: signals.state,
    stateTime: 0,
    nod: 0,
  });

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const a = anim.current;
    a.t += dt;
    a.stateTime += dt;
    const t = a.t;
    const s = signals.state;
    const motion = signals.reducedMotion ? 0.35 : 1;

    if (s !== a.prevState) {
      // People tend to blink at conversational turn changes.
      if (s === "hearing" || s === "speaking") a.nextBlink = Math.min(a.nextBlink, t + 0.08);
      a.prevState = s;
      a.stateTime = 0;
    }

    // ---- expression blend ----
    const target = EXPRESSIONS[signals.expression] ?? EXPRESSIONS.neutral;
    const e = a.expr;
    (Object.keys(e) as (keyof ExprTarget)[]).forEach((k) => (e[k] = damp(e[k], target[k], 6, dt)));

    // ---- audio ----
    const mouthTarget = signals.sampleMouth();
    a.mouth = smoothMouth(a.mouth, mouthTarget, dt);
    const m = a.mouth;
    const micLevel = signals.muted ? 0 : signals.sampleMic();
    a.mic = damp(a.mic, s === "hearing" || s === "listening" ? micLevel : 0, 14, dt);

    // ---- blinking ----
    if (a.blinkStart < 0 && t >= a.nextBlink) {
      a.blinkStart = t;
    }
    if (a.blinkStart >= 0) {
      const p = (t - a.blinkStart) / 0.16;
      a.blink = p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2);
      if (p >= 1) {
        a.blink = 0;
        a.blinkStart = -1;
        if (!a.doubleBlink && Math.random() < 0.15) {
          a.doubleBlink = true;
          a.nextBlink = t + 0.12;
        } else {
          a.doubleBlink = false;
          a.nextBlink = t + 2 + Math.random() * 3.5;
        }
      }
    }

    // ---- gaze: saccades + pointer + expression ----
    if (t > a.nextSaccade) {
      const range = s === "speaking" ? 0.12 : 0.18;
      a.saccade.set((Math.random() - 0.5) * range, (Math.random() - 0.5) * range * 0.6);
      a.nextSaccade = t + 0.8 + Math.random() * 2.2;
    }
    const engaged = s === "hearing" || s === "speaking" || s === "listening";
    const pointerWeight = s === "idle" ? 0.35 : 0.12;
    const gx = (engaged ? 0 : a.saccade.x) + e.gazeX * 0.5 + frame.pointer.x * pointerWeight + a.saccade.x * 0.4;
    const gy = a.saccade.y + e.gazeY * 0.45 + frame.pointer.y * pointerWeight * 0.6;
    for (const g of [gazeL.current, gazeR.current]) {
      if (!g) continue;
      g.rotation.y = damp(g.rotation.y, THREE.MathUtils.clamp(gx, -0.45, 0.45), 18, dt);
      g.rotation.x = damp(g.rotation.x, THREE.MathUtils.clamp(-gy, -0.35, 0.35), 18, dt);
    }

    // ---- eyes: open amount ----
    const listeningWiden = s === "hearing" ? 0.08 + a.mic * 0.1 : 0;
    const smileSquint = e.squint + Math.max(0, m.energy - 0.4) * 0.15;
    const eyeY = Math.max(0.06, (e.eyeOpen + listeningWiden) * (1 - smileSquint * 0.45) * (1 - a.blink * 0.94));
    eyeL.current?.scale.set(1, eyeY, 1);
    eyeR.current?.scale.set(1, eyeY, 1);

    // ---- brows ----
    const speakBrow = s === "speaking" ? m.energy * 0.05 : 0;
    const listenBrow = s === "hearing" ? 0.04 : 0;
    const browBase = 0.42 + e.browY + speakBrow + listenBrow;
    if (browL.current && browR.current) {
      browL.current.position.y = damp(browL.current.position.y, browBase + e.browAsym, 14, dt);
      browR.current.position.y = damp(browR.current.position.y, browBase - e.browAsym * 0.3, 14, dt);
      browL.current.rotation.z = damp(browL.current.rotation.z, Math.PI / 2 - 0.12 - e.browTilt, 10, dt);
      browR.current.rotation.z = damp(browR.current.rotation.z, Math.PI / 2 + 0.12 + e.browTilt, 10, dt);
    }

    // ---- mouth ----
    const open = m.open;
    const wide = m.wide;
    const smile = e.smile * (1 - open * 0.5);
    const halfW = (0.15 + Math.max(0, smile) * 0.035) * (1 + wide * 0.22 - open * 0.12);
    const upper = 0.008 + open * 0.05;
    const lower = 0.01 + open * 0.15 * (1 - Math.max(0, wide) * 0.25);
    mouthGeo.update(halfW, smile, upper, lower);
    // Tongue sits at the bottom of the open mouth; teeth peek from the top.
    tongueGeo.update(halfW * 0.6 * Math.min(1, open * 4), smile * 0.4, Math.max(0, lower * 0.25), lower * 0.7, -lower * 0.38, 0.016);
    teethGeo.update(halfW * 0.7 * Math.min(1, open * 3), smile, 0, Math.min(0.022, open * 0.05), upper * 0.6, 0.016);
    if (tongue.current) tongue.current.visible = open > 0.04;
    if (teeth.current) teeth.current.visible = open > 0.1;

    // ---- cheeks & glow ----
    cheekMat.opacity = damp(cheekMat.opacity, e.blush * 0.55, 4, dt);
    const glowTarget =
      s === "speaking" ? 0.6 + m.energy * 2.2 : s === "hearing" ? 0.5 + a.mic * 2 : s === "thinking" ? 0.6 + Math.sin(t * 6) * 0.35 : s === "idle" ? 0.25 : 0.55;
    if (glowMat.current) glowMat.current.emissiveIntensity = damp(glowMat.current.emissiveIntensity, glowTarget, 12, dt);
    if (glowLight.current) glowLight.current.intensity = glowMat.current ? glowMat.current.emissiveIntensity * 0.6 : 0;

    // Listening halo on the floor expands with the user's voice.
    if (ring.current && ringMat.current) {
      const active = s === "hearing" || s === "listening";
      const r = 1 + (active ? 0.08 + a.mic * 0.5 : 0) + Math.sin(t * 2) * 0.02;
      ring.current.scale.setScalar(damp(ring.current.scale.x, r, 10, dt));
      ringMat.current.opacity = damp(ringMat.current.opacity, active ? 0.35 + a.mic * 0.5 : s === "speaking" ? 0.2 : 0.08, 6, dt);
    }

    // ---- head & body motion ----
    const leanTarget = s === "hearing" ? 1 : s === "listening" ? 0.35 : 0;
    a.lean = damp(a.lean, leanTarget, 4, dt);
    a.ear = damp(a.ear, s === "hearing" ? 1 : s === "listening" ? 0.6 : s === "thinking" ? 0.3 : 0, 6, dt);
    a.nod = damp(a.nod, s === "hearing" ? a.mic : s === "speaking" ? m.energy : 0, 10, dt);

    if (head.current) {
      const h = head.current;
      const sway = Math.sin(t * 0.7) * 0.035 * motion;
      const think = s === "thinking" ? 0.1 : 0;
      h.rotation.z = damp(h.rotation.z, sway + a.lean * 0.08 + think * 0.7, 5, dt);
      h.rotation.y = damp(h.rotation.y, frame.pointer.x * 0.25 * pointerWeight * 2 + Math.sin(t * 0.45) * 0.05 * motion, 4, dt);
      h.rotation.x = damp(
        h.rotation.x,
        -frame.pointer.y * 0.12 * pointerWeight * 2 + a.lean * 0.1 - think * 0.6 + a.nod * 0.06 * Math.sin(t * 9) * motion,
        8,
        dt,
      );
      h.position.y = 0.55 + Math.sin(t * 1.6) * 0.012 * motion + (s === "speaking" ? m.energy * 0.02 : 0);
    }
    if (body.current) {
      const breathe = 1 + Math.sin(t * 1.6) * 0.015 * motion;
      body.current.scale.set(1 + (breathe - 1) * 0.5, breathe, 1 + (breathe - 1) * 0.5);
    }
    if (root.current) {
      root.current.position.z = damp(root.current.position.z, a.lean * 0.18, 4, dt);
      root.current.position.y = Math.sin(t * 0.9) * 0.03 * motion;
    }
    const earWiggle = Math.sin(t * 2.2) * 0.04 * motion;
    if (earL.current) earL.current.rotation.z = damp(earL.current.rotation.z, 0.5 - a.ear * 0.28 + earWiggle, 8, dt);
    if (earR.current) earR.current.rotation.z = damp(earR.current.rotation.z, -0.5 + a.ear * 0.28 - earWiggle, 8, dt);
  });

  return (
    <group ref={root}>
      {/* Floor halo (listening indicator) */}
      <mesh ref={ring} position={[0, -1.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.85, 1.05, 64]} />
        <meshBasicMaterial ref={ringMat} color={PALETTE.glow} transparent opacity={0.1} depthWrite={false} />
      </mesh>
      <mesh position={[0, -1.73, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.9, 48]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.12} depthWrite={false} />
      </mesh>

      {/* Body */}
      <group ref={body} position={[0, -1.05, 0]}>
        <mesh>
          <capsuleGeometry args={[0.5, 0.45, 12, 32]} />
          <meshPhysicalMaterial color={PALETTE.body} roughness={0.55} sheen={1} sheenColor="#d9d4ff" sheenRoughness={0.5} />
        </mesh>
        {/* Chest light — pulses with voice */}
        <mesh position={[0, 0.12, 0.47]} scale={[1, 1, 0.35]}>
          <sphereGeometry args={[0.11, 24, 16]} />
          <meshStandardMaterial ref={glowMat} color={PALETTE.glow} emissive={PALETTE.glow} emissiveIntensity={0.4} toneMapped={false} />
        </mesh>
        <pointLight ref={glowLight} position={[0, 0.15, 0.8]} color={PALETTE.glow} intensity={0.3} distance={2.2} />
      </group>

      {/* Head */}
      <group ref={head} position={[0, 0.55, 0]}>
        <mesh scale={[1.04, 0.97, 0.98]}>
          <sphereGeometry args={[HEAD_R, 64, 48]} />
          <meshPhysicalMaterial
            color={PALETTE.skin}
            roughness={0.5}
            sheen={1}
            sheenColor="#ffffff"
            sheenRoughness={0.6}
            clearcoat={0.25}
            clearcoatRoughness={0.6}
          />
        </mesh>

        {/* Ears */}
        {([1, -1] as const).map((side) => (
          <group key={side} ref={side === 1 ? earR : earL} position={[0.62 * side, 0.68, -0.05]} rotation={[0, 0, -0.5 * side]}>
            <mesh position={[0, 0.32, 0]} scale={[0.6, 1, 0.5]}>
              <capsuleGeometry args={[0.2, 0.38, 8, 24]} />
              <meshPhysicalMaterial color={PALETTE.skinDeep} roughness={0.5} sheen={1} sheenColor="#ffffff" />
            </mesh>
            <mesh position={[0, 0.34, 0.07]} scale={[0.36, 0.72, 0.3]}>
              <capsuleGeometry args={[0.2, 0.36, 8, 24]} />
              <meshStandardMaterial color={PALETTE.earInner} roughness={0.6} />
            </mesh>
          </group>
        ))}

        <Eye side={-1} groupRef={eyeL} gazeRef={gazeL} />
        <Eye side={1} groupRef={eyeR} gazeRef={gazeR} />

        {/* Brows */}
        {([-1, 1] as const).map((side) => (
          <mesh
            key={side}
            ref={side === -1 ? browL : browR}
            position={[0.36 * side, 0.42, onHead(0.36, 0.42, 0.015)[2]]}
            rotation={[0, 0.36 * side, Math.PI / 2 + 0.12 * side]}
          >
            <capsuleGeometry args={[0.028, 0.16, 6, 12]} />
            <meshStandardMaterial color={PALETTE.brow} roughness={0.6} />
          </mesh>
        ))}

        {/* Cheeks */}
        {([-1, 1] as const).map((side) => (
          <mesh key={side} material={cheekMat} position={onHead(0.6 * side, -0.2, 0.004)} rotation={[0, 0.65 * side, 0]} scale={[1, 0.6, 0.1]}>
            <circleGeometry args={[0.13, 32]} />
          </mesh>
        ))}

        {/* Mouth (deformable) */}
        <mesh geometry={mouthGeo} renderOrder={1}>
          <meshBasicMaterial color={PALETTE.mouth} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={tongue} geometry={tongueGeo} renderOrder={2}>
          <meshBasicMaterial color={PALETTE.tongue} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={teeth} geometry={teethGeo} renderOrder={2}>
          <meshBasicMaterial color={PALETTE.teeth} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}
