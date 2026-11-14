import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";
import type { Mood } from "./meta";

/**
 * The liquid body of an agent: a glossy sphere whose surface flows, lit so that it shades
 * from one colour at the top to another at the bottom. Rendered with WebGL so the highlights
 * and the wobble are real, not a filter; it behaves the same in Safari.
 *
 * Everything animates towards a per-mood target, so mood changes are always smooth.
 */

interface Motion {
  /** How far the surface deforms */
  distort: number;
  /** How fast it flows */
  speed: number;
  /** Breathing: amplitude and rate of the scale pulse */
  pulse: number;
  rate: number;
  scale: number;
}

const MOTION: Record<Mood, Motion> = {
  asleep: { distort: 0.16, speed: 0.35, pulse: 0.012, rate: 0.9, scale: 0.86 },
  idle: { distort: 0.3, speed: 0.9, pulse: 0.012, rate: 1.2, scale: 0.9 },
  listening: { distort: 0.38, speed: 1.7, pulse: 0.03, rate: 3.2, scale: 0.92 },
  thinking: { distort: 0.44, speed: 2.4, pulse: 0.015, rate: 2, scale: 0.88 },
  nudging: { distort: 0.4, speed: 2.1, pulse: 0.045, rate: 5.5, scale: 0.92 },
  speaking: { distort: 0.5, speed: 3.1, pulse: 0.04, rate: 7.5, scale: 0.94 },
};

interface DistortImpl extends THREE.MeshPhysicalMaterial {
  time: number;
  distort: number;
}

function Body({ from, to, mood }: { from: string; to: string; mood: Mood }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<DistortImpl>(null);
  const light = useRef<THREE.HemisphereLight>(null);
  const clock = useRef({ flow: Math.random() * 10, beat: 0, speed: MOTION[mood].speed, scale: MOTION[mood].scale });
  const ground = useMemo(() => new THREE.Color(to), [to]);
  // The body itself carries the colour (a mix of the two), the lights only shade it top to bottom.
  const tint = useMemo(() => new THREE.Color(from).lerp(new THREE.Color(to), 0.55), [from, to]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const target = MOTION[mood];
    const c = clock.current;
    // Ease the flow speed and integrate it ourselves, so a speed change never makes the surface jump.
    c.speed = THREE.MathUtils.damp(c.speed, target.speed, 3, dt);
    c.flow += dt * c.speed;
    c.beat += dt * target.rate;

    const m = material.current;
    if (m) {
      m.time = c.flow;
      m.distort = THREE.MathUtils.damp(m.distort, target.distort, 3, dt);
      m.color.lerp(tint, 1 - Math.exp(-4 * dt));
      m.emissive.lerp(ground, 1 - Math.exp(-4 * dt));
    }
    if (mesh.current) {
      const s = (c.scale = THREE.MathUtils.damp(c.scale, target.scale * (1 + target.pulse * Math.sin(c.beat)), 6, dt));
      // Slightly wider than tall, so it sits like a soft lump rather than a ball
      mesh.current.scale.set(s * 1.05, s * 0.95, s);
      mesh.current.rotation.z += dt * 0.08 * c.speed;
    }
    if (light.current) {
      light.current.groundColor.lerp(ground, 1 - Math.exp(-4 * dt));
    }
  });

  return (
    <>
      <hemisphereLight ref={light} args={["#ffffff", to, 1.5]} />
      <directionalLight position={[-2.5, 3.5, 4]} intensity={1.1} />
      <mesh ref={mesh} scale={MOTION[mood].scale}>
        <sphereGeometry args={[1, 96, 96]} />
        <MeshDistortMaterial
          ref={material as never}
          color={tint}
          emissive={to}
          emissiveIntensity={0.32}
          speed={0}
          distort={MOTION[mood].distort}
          radius={1}
          roughness={0.2}
          metalness={0.02}
          clearcoat={1}
          clearcoatRoughness={0.08}
          envMapIntensity={0.55}
          iridescence={0.35}
          iridescenceIOR={1.25}
        />
      </mesh>
      {/* A tiny studio, built in code: no image to download */}
      <Environment resolution={64}>
        <Lightformer form="rect" intensity={3.2} position={[-2.5, 4, 3]} scale={[5, 3, 1]} />
        <Lightformer form="circle" intensity={1.4} position={[4, 1, 2]} scale={2.5} />
        <Lightformer form="rect" intensity={0.5} position={[0, -4, 1]} scale={[8, 2, 1]} color={to} />
      </Environment>
    </>
  );
}

export function Blob({ from, to, mood }: { from: string; to: string; mood: Mood }) {
  return (
    <Canvas
      // Measure the untransformed box: figures are created while a layout animation is scaling them
      resize={{ offsetSize: true }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      camera={{ position: [0, 0, 4.4], fov: 34 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <Body from={from} to={to} mood={mood} />
    </Canvas>
  );
}
