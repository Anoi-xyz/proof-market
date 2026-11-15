import React, { useEffect, useRef } from 'react';
import okxLogo from '../assets/exchanges/okx.jpg';
import bitgetLogo from '../assets/exchanges/bitget.jpg';
import binanceLogo from '../assets/exchanges/binance.jpg';
import bybitLogo from '../assets/exchanges/bybit.jpg';

export const EXCHANGES = [
  {
    id: 'okx',
    name: 'OKX',
    caption: 'Account level',
    tag: 'Soon',
    isLive: false,
    img: okxLogo,
    textColor: '#fff',
    bg: 'radial-gradient(70% 60% at 30% 25%,#7c5cff,transparent 60%),radial-gradient(60% 50% at 80% 88%,#16e0ff,transparent 65%),#0b0b14',
  },
  {
    id: 'bitget',
    name: 'Bitget',
    caption: 'Account ownership',
    tag: 'Soon',
    isLive: false,
    img: bitgetLogo,
    textColor: '#06222a',
    bg: 'radial-gradient(70% 60% at 25% 20%,#e4fffc,transparent 60%),radial-gradient(60% 60% at 85% 92%,#2a5bff,transparent 65%),#00e5ff',
  },
  {
    id: 'binance',
    name: 'Binance',
    caption: '30-day spot PnL',
    tag: 'Live',
    isLive: true,
    img: binanceLogo,
    textColor: '#2a1d00',
    bg: 'radial-gradient(70% 60% at 30% 25%,#fff3b0,transparent 60%),radial-gradient(60% 60% at 80% 92%,#ff7a00,transparent 65%),#f3ba2f',
  },
  {
    id: 'bybit',
    name: 'Bybit',
    caption: 'Trade volume',
    tag: 'Soon',
    isLive: false,
    img: bybitLogo,
    textColor: '#fff',
    bg: 'radial-gradient(70% 60% at 75% 20%,#ffb020,transparent 55%),radial-gradient(60% 60% at 20% 92%,#6a2cff,transparent 65%),#14141c',
  },
];

const HOLD = 2400;
const MOVE = 1200;
const CYC = HOLD + MOVE;

function ease(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export default function ExchangeCarousel({ onSelectExchange, isPanelOpen }) {
  const stageRef = useRef(null);
  const cardsRef = useRef([]);
  const hovRef = useRef(false);
  const openRef = useRef(isPanelOpen);

  // Sync openRef with prop changes
  useEffect(() => {
    openRef.current = isPanelOpen;
  }, [isPanelOpen]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const cards = cardsRef.current.filter(Boolean);
    const N = cards.length;
    if (N === 0) return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const still = mediaQuery.matches;

    function draw(pos) {
      if (!cards[0]) return;
      const cw = parseFloat(window.getComputedStyle(cards[0]).width) || 180;

      cards.forEach((el, i) => {
        let t = ((i - pos) % N + N) % N;
        if (t > N / 2) t -= N;
        const a = Math.abs(t);
        const s = t < 0 ? -1 : 1;
        let rot = a <= 1 ? -s * 150 * a : -s * (150 + 30 * (a - 1));
        const front = Math.max(0, 1 - a);
        rot += -9 * front;
        const x = t * cw * 1.32;
        const sc = 1 + 0.16 * Math.min(a, 1);
        const op = a <= 1 ? 1 : Math.max(0, 1 - (a - 1) * 1.5);

        el.style.transform = `translateX(${x}px) rotateY(${rot}deg) rotateZ(${-2.5 * front}deg) scale(${sc})`;
        el.style.opacity = String(op);
        el.style.setProperty('--g', (Math.min(a, 1) * 0.6).toFixed(2));
        el.style.zIndex = String(10 - Math.round(a * 3));
        el.style.pointerEvents = op > 0.3 ? 'auto' : 'none';
      });
    }

    if (still) {
      draw(0);
      const handleResize = () => draw(0);
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }

    let T = 0;
    let lt = performance.now();
    let rafId = null;

    const onPointerOver = (e) => {
      hovRef.current = !!e.target.closest('.landing-card');
    };
    const onPointerLeave = () => {
      hovRef.current = false;
    };

    stage.addEventListener('pointerover', onPointerOver);
    stage.addEventListener('pointerleave', onPointerLeave);

    const onVisibilityChange = () => {
      if (!document.hidden) {
        lt = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    function loop(now) {
      if (document.hidden) {
        lt = now;
        rafId = requestAnimationFrame(loop);
        return;
      }

      const dt = Math.min(now - lt, 100);
      lt = now;

      // Freeze at hold phase while hovered or modal is open; let in-progress move finish
      if (!((hovRef.current || openRef.current) && T % CYC < HOLD)) {
        T += dt;
      }

      const k = Math.floor(T / CYC);
      const r = T % CYC;
      draw(k + (r < HOLD ? 0 : ease((r - HOLD) / MOVE)));

      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      stage.removeEventListener('pointerover', onPointerOver);
      stage.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return (
    <div className="landing-stage" ref={stageRef}>
      <div className="landing-blob t" aria-hidden="true" />
      <div className="landing-blob b" aria-hidden="true" />

      {EXCHANGES.map((d, i) => (
        <div
          key={d.id}
          ref={(el) => {
            cardsRef.current[i] = el;
          }}
          className="landing-card"
          role="button"
          tabIndex={0}
          style={{
            background: d.bg,
            '--tx': d.textColor,
          }}
          onClick={(e) => onSelectExchange(d, e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectExchange(d, e.currentTarget);
            }
          }}
          aria-label={`${d.name} — ${d.caption}. Status: ${d.tag}`}
        >
          <h3>
            {d.name}
            <br />
            {d.caption}
          </h3>
          <div className="landing-tile">
            <img alt={`${d.name} logo`} src={d.img} />
          </div>
          <div className="landing-row">
            <p>Verify with Primus</p>
            <span className="landing-tag">{d.tag}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
