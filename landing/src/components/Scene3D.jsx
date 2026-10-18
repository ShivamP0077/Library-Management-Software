import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import StaticHall from './StaticHall.jsx';

const HeroScene = lazy(() => import('./HeroScene.jsx'));

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * Lazy-loads the three.js hero only after first paint (idle), only if WebGL exists,
 * pauses rendering when offscreen and renders a still frame for reduced-motion users.
 */
export default function Scene3D({ eventSource }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(true);
  const [visible, setVisible] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!hasWebGL()) {
      setSupported(false);
      return;
    }
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
    const id = idle(() => setReady(true), { timeout: 1200 });
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(id) : clearTimeout(id));
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '100px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="absolute inset-0">
      {(!supported || !loaded) && (
        <div className={`absolute inset-0 transition-opacity duration-700 ${loaded ? 'opacity-0' : 'opacity-100'}`}>
          <StaticHall />
        </div>
      )}
      {supported && ready && (
        <Suspense fallback={null}>
          <div
            className={`absolute inset-0 transition-opacity duration-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          >
            <HeroScene eventSource={eventSource} active={visible} still={reduced} onReady={() => setTimeout(() => setLoaded(true), 120)} />
          </div>
        </Suspense>
      )}
    </div>
  );
}
