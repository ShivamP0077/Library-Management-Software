import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, RoundedBox, Sparkles, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

const STATUS = {
  occupied: new THREE.Color('#E8B54A'),
  free: new THREE.Color('#34D399'),
  expiring: new THREE.Color('#FB7185'),
};
const STATUS_KEYS = ['occupied', 'occupied', 'occupied', 'free', 'free', 'expiring'];
const COLS = 6;
const ROWS = 4;

function Desk({ position, lampRef, topRef }) {
  return (
    <group position={position}>
      <RoundedBox args={[0.8, 0.07, 0.5]} radius={0.025} smoothness={3} position={[0, 0.55, 0]} castShadow receiveShadow>
        <meshStandardMaterial ref={topRef} color="#3a332d" roughness={0.55} metalness={0.1} />
      </RoundedBox>
      <mesh position={[0, 0.27, -0.18]} castShadow>
        <boxGeometry args={[0.72, 0.5, 0.05]} />
        <meshStandardMaterial color="#231f1c" roughness={0.8} />
      </mesh>
      {/* privacy divider */}
      <mesh position={[0, 0.72, -0.235]}>
        <boxGeometry args={[0.8, 0.3, 0.025]} />
        <meshStandardMaterial color="#57534e" roughness={0.4} metalness={0.2} transparent opacity={0.85} />
      </mesh>
      {/* status lamp */}
      <mesh position={[0.28, 0.62, -0.12]}>
        <sphereGeometry args={[0.055, 20, 20]} />
        <meshStandardMaterial ref={lampRef} color="#E8B54A" emissive="#E8B54A" emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      {/* book on desk */}
      <mesh position={[-0.15, 0.6, 0.03]} rotation={[0, 0.3, 0]}>
        <boxGeometry args={[0.22, 0.03, 0.16]} />
        <meshStandardMaterial color="#f5efe4" roughness={0.9} />
      </mesh>
      {/* chair */}
      <group position={[0, 0, 0.42]}>
        <RoundedBox args={[0.34, 0.05, 0.3]} radius={0.02} position={[0, 0.33, 0]} castShadow>
          <meshStandardMaterial color="#1c1917" roughness={0.6} />
        </RoundedBox>
        <RoundedBox args={[0.34, 0.32, 0.045]} radius={0.02} position={[0, 0.52, 0.14]} castShadow>
          <meshStandardMaterial color="#1c1917" roughness={0.6} />
        </RoundedBox>
        <mesh position={[0, 0.16, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.32, 10]} />
          <meshStandardMaterial color="#78716c" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

function Book({ position, rotation, color, size = [0.95, 1.3, 0.22], speed = 1.4, still }) {
  const [w, h, d] = size;
  return (
    <Float speed={still ? 0 : speed} rotationIntensity={still ? 0 : 0.6} floatIntensity={still ? 0 : 1.1} floatingRange={[-0.12, 0.12]}>
      <group position={position} rotation={rotation}>
        <RoundedBox args={[w, h, d]} radius={0.03} smoothness={3} castShadow>
          <meshStandardMaterial color={color} roughness={0.45} metalness={0.15} />
        </RoundedBox>
        <mesh position={[0.03, 0, 0]}>
          <boxGeometry args={[w - 0.02, h - 0.07, d + 0.004 - 0.06]} />
          <meshStandardMaterial color="#f3ead8" roughness={0.95} />
        </mesh>
        {/* gold foil band on spine */}
        <mesh position={[-w / 2 - 0.001, h * 0.28, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[d * 0.9, 0.05]} />
          <meshStandardMaterial color="#E8B54A" metalness={1} roughness={0.25} emissive="#7a5208" emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[-w / 2 - 0.001, -h * 0.28, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[d * 0.9, 0.05]} />
          <meshStandardMaterial color="#E8B54A" metalness={1} roughness={0.25} emissive="#7a5208" emissiveIntensity={0.4} />
        </mesh>
      </group>
    </Float>
  );
}

function Hall({ still }) {
  const group = useRef();
  const lamps = useRef([]);
  const tops = useRef([]);
  const statuses = useMemo(
    () => Array.from({ length: COLS * ROWS }, (_, i) => STATUS_KEYS[(i * 7 + 3) % STATUS_KEYS.length]),
    []
  );
  const clock = useRef(0);
  const tmp = useMemo(() => new THREE.Color(), []);
  const deskTop = useMemo(() => new THREE.Color('#3a332d'), []);

  const positions = useMemo(() => {
    const out = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) out.push([(c - (COLS - 1) / 2) * 1.02, 0, (r - (ROWS - 1) / 2) * 1.12]);
    return out;
  }, []);

  useEffect(() => {
    lamps.current.forEach((m, i) => {
      if (!m) return;
      m.color.copy(STATUS[statuses[i]]);
      m.emissive.copy(STATUS[statuses[i]]);
    });
  }, [statuses]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const px = still ? 0 : state.pointer.x;
    const py = still ? 0 : state.pointer.y;
    const targetY = -0.55 + px * 0.22 + (still ? 0 : Math.sin(t * 0.15) * 0.08);
    const targetX = py * -0.06;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, targetY, 2.5, delta);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, targetX, 2.5, delta);

    if (still) return;
    clock.current += delta;
    if (clock.current > 0.75) {
      clock.current = 0;
      const i = Math.floor(Math.random() * statuses.length);
      const keys = Object.keys(STATUS);
      statuses[i] = keys[(keys.indexOf(statuses[i]) + 1) % keys.length];
    }
    lamps.current.forEach((m, i) => {
      if (!m) return;
      const target = STATUS[statuses[i]];
      m.color.lerp(target, Math.min(1, delta * 4));
      m.emissive.lerp(target, Math.min(1, delta * 4));
      const top = tops.current[i];
      if (top) {
        tmp.copy(deskTop).lerp(target, 0.08);
        top.color.lerp(tmp, Math.min(1, delta * 3));
      }
    });
  });

  return (
    <group ref={group} rotation={[0, -0.55, 0]} position={[0, -0.9, 0]}>
      {/* floor */}
      <RoundedBox args={[7.4, 0.24, 5.6]} radius={0.12} smoothness={4} position={[0, -0.12, 0]} receiveShadow>
        <meshStandardMaterial color="#1f1b18" roughness={0.75} metalness={0.05} />
      </RoundedBox>
      <RoundedBox args={[7.55, 0.06, 5.75]} radius={0.03} position={[0, -0.25, 0]}>
        <meshStandardMaterial color="#E8B54A" emissive="#CA8A04" emissiveIntensity={1.2} toneMapped={false} />
      </RoundedBox>
      {/* aisle runner */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <planeGeometry args={[6.9, 5.1]} />
        <meshStandardMaterial color="#26211d" roughness={0.9} />
      </mesh>
      {positions.map((p, i) => (
        <Desk key={i} position={p} lampRef={(m) => (lamps.current[i] = m)} topRef={(m) => (tops.current[i] = m)} />
      ))}
      {/* bookshelf at back */}
      <group position={[0, 0, -2.55]}>
        <mesh position={[0, 0.7, 0]} castShadow>
          <boxGeometry args={[6.6, 1.4, 0.32]} />
          <meshStandardMaterial color="#292524" roughness={0.7} />
        </mesh>
        {Array.from({ length: 34 }).map((_, i) => {
          const colors = ['#7f1d1d', '#1e3a8a', '#14532d', '#a16207', '#44403c', '#9a3412', '#f3ead8'];
          const h = 0.42 + ((i * 37) % 10) / 50;
          const shelf = i < 17 ? 0 : 1;
          const x = -3.05 + (i % 17) * 0.36;
          return (
            <mesh key={i} position={[x, 0.1 + shelf * 0.65 + h / 2, 0.08]}>
              <boxGeometry args={[0.28, h, 0.24]} />
              <meshStandardMaterial color={colors[(i * 5) % colors.length]} roughness={0.6} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function Rig({ still }) {
  useFrame((state, delta) => {
    if (still) return;
    const { camera, pointer } = state;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, 9.4 + pointer.x * 0.5, 2, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, 7.6 + pointer.y * 0.3, 2, delta);
    camera.lookAt(0, -0.1, 0);
  });
  return null;
}

export default function HeroScene({ eventSource, active = true, still = false, onReady }) {
  const getW = () => (typeof window !== 'undefined' ? window.innerWidth : 1440);
  const [width, setWidth] = useState(getW);
  const compact = width < 768;
  const tablet = width >= 768 && width < 1024;
  useEffect(() => {
    let raf;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(getW()));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <Canvas
      shadows={!compact && !tablet}
      dpr={[1, compact ? 1.25 : tablet ? 1.5 : 1.75]}
      camera={{ position: [9.4, 7.6, 10.4], fov: compact ? 32 : tablet ? 31 : 33 }}
      performance={{ min: 0.6 }}
      gl={{ antialias: !compact, powerPreference: 'high-performance', alpha: true }}
      frameloop={still ? 'demand' : active ? 'always' : 'never'}
      eventSource={eventSource}
      eventPrefix="client"
      onCreated={({ camera }) => {
        camera.lookAt(0, -0.1, 0);
        onReady?.();
      }}
      aria-hidden="true"
    >
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#fff1d6', '#0c0a09', 0.45]} />
      <directionalLight
        position={[5, 9, 5]}
        intensity={1.6}
        color="#ffe7bf"
        castShadow={!compact && !tablet}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
      />
      <directionalLight position={[-7, 4, -5]} intensity={0.7} color="#93c5fd" />
      <pointLight position={[0, 3, 0]} intensity={8} distance={8} color="#E8B54A" />

      <group scale={compact ? 0.97 : 1}>
      <Hall still={still} />

      <Book still={still} position={[-3.6, 2.3, 0.6]} rotation={[0.3, 0.6, -0.35]} color="#7f1d1d" speed={1.2} />
      <Book still={still} position={[3.5, 2.6, -1.1]} rotation={[-0.2, -0.5, 0.25]} color="#1e3a8a" speed={1.6} size={[0.85, 1.15, 0.2]} />
      <Book still={still} position={[2.6, 1.6, 2.4]} rotation={[0.5, 0.2, 0.4]} color="#A16207" speed={1.1} size={[0.75, 1.0, 0.18]} />
      {!compact && <Book still={still} position={[-1.6, 3.3, -1.8]} rotation={[-0.4, 0.9, 0.1]} color="#14532d" speed={1.4} size={[0.8, 1.1, 0.2]} />}
      <Book still={still} position={[0.9, 3.6, 0.4]} rotation={[0.2, -0.3, -0.6]} color="#292524" speed={1.8} size={[0.6, 0.85, 0.16]} />
      </group>

      {!still && <Sparkles count={compact ? 24 : tablet ? 50 : 80} scale={[9, 5, 7]} position={[0, 1.6, 0]} size={2.2} speed={0.25} color="#F5D489" opacity={0.7} />}
      <ContactShadows position={[0, -1.25, 0]} opacity={0.55} scale={14} blur={2.6} far={4} frames={1} />
      <Rig still={still} />
    </Canvas>
  );
}
