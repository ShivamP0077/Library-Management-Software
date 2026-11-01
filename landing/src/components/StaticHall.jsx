// Lightweight CSS/SVG fallback used before the 3D scene loads and when WebGL is unavailable.
const colors = ['#E8B54A', '#E8B54A', '#34D399', '#E8B54A', '#FB7185', '#34D399'];

export default function StaticHall() {
  return (
    <div className="flex h-full w-full items-center justify-center" aria-hidden="true">
      <div className="relative w-[78%] max-w-[560px]" style={{ perspective: '1200px' }}>
        <div
          className="grid grid-cols-6 gap-3 rounded-3xl border border-gold-400/40 bg-ink-800/80 p-6 shadow-glow"
          style={{ transform: 'rotateX(55deg) rotateZ(-28deg)', transformStyle: 'preserve-3d' }}
        >
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="relative aspect-[4/3] rounded-md bg-ink-600/80">
              <span
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full"
                style={{ background: colors[(i * 7 + 3) % colors.length], boxShadow: `0 0 10px ${colors[(i * 7 + 3) % colors.length]}` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
