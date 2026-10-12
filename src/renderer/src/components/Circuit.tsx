import { memo, useId } from 'react'

/** Faint PCB texture behind everything; shows through wherever panels are transparent. */
export const CircuitBackdrop = memo(function CircuitBackdrop(): React.JSX.Element {
  const id = useId()
  return (
    <svg className="circuit-backdrop" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={id} width="240" height="240" patternUnits="userSpaceOnUse">
          <g className="trace a" fill="none">
            <path d="M0 40 H60 L84 64 H150 L170 44 H240" />
            <path d="M0 150 H36 L56 170 H120 V240" />
            <path d="M120 0 V30 L140 50 V96 L160 116 H240" />
            <path d="M200 240 V196 L180 176 H150" />
          </g>
          <g className="trace b" fill="none">
            <path d="M0 210 H70 L90 190 H110" />
            <path d="M60 0 V22 L40 42 V90 L20 110 H0" />
            <path d="M240 190 H206 L190 206" />
          </g>
          <g className="via">
            <circle cx="60" cy="40" r="3" />
            <circle cx="150" cy="64" r="3" />
            <circle cx="56" cy="170" r="3" />
            <circle cx="140" cy="96" r="3" />
            <circle cx="150" cy="176" r="3" />
            <circle cx="110" cy="190" r="3" />
            <circle cx="20" cy="110" r="3" />
            <circle cx="190" cy="206" r="3" />
          </g>
          <g className="chip">
            <rect x="170" y="130" width="40" height="28" rx="2" />
            <path d="M178 126v4M190 126v4M202 126v4M178 158v4M190 158v4M202 158v4" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
})

interface WireProps {
  /** Which wiring layout to draw; different dividers get different shapes. */
  variant?: 'a' | 'b' | 'c'
}

const NODES: Record<NonNullable<WireProps['variant']>, { x: string; y: number }[]> = {
  a: [{ x: '18%', y: 6 }, { x: '70%', y: 16 }, { x: '99%', y: 6 }],
  b: [{ x: '1%', y: 16 }, { x: '38%', y: 6 }, { x: '84%', y: 6 }],
  c: [{ x: '1%', y: 6 }, { x: '62%', y: 16 }, { x: '99%', y: 16 }]
}

type Seg = [string, number, string, number]

const SEGMENTS: Record<NonNullable<WireProps['variant']>, Seg[]> = {
  a: [['0%', 6, '18%', 6], ['18%', 6, '22%', 16], ['22%', 16, '70%', 16], ['70%', 16, '74%', 6], ['74%', 6, '100%', 6]],
  b: [['0%', 16, '38%', 16], ['38%', 16, '38%', 6], ['38%', 6, '100%', 6]],
  c: [['0%', 6, '62%', 6], ['62%', 6, '62%', 16], ['62%', 16, '100%', 16]]
}

const LONGEST: Record<NonNullable<WireProps['variant']>, number> = { a: 2, b: 2, c: 0 }

/**
 * Horizontal divider drawn as a PCB trace with solder nodes. A pulse runs along it while a
 * track is playing (see `html[data-playing]` in the stylesheet).
 */
export const Wire = memo(function Wire({ variant = 'a' }: WireProps): React.JSX.Element {
  // Path data can't use percentages, so each trace is a set of <line> segments.
  const segments = SEGMENTS[variant]
  const longest = segments[LONGEST[variant]]
  return (
    <svg className="wire" height="22" aria-hidden="true" focusable="false">
      {segments.map((s, i) => (
        <line key={i} className="trace-line" x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} />
      ))}
      <line className="pulse" pathLength={100} x1={longest[0]} y1={longest[1]} x2={longest[2]} y2={longest[3]} />
      {NODES[variant].map((n, i) => (
        <circle key={i} className="node" cx={n.x} cy={n.y} r="3.5" />
      ))}
    </svg>
  )
})

/** Vertical bus between the sidebar and the player: parallel wires with jogs and pads. */
export const Bus = memo(function Bus(): React.JSX.Element {
  return (
    <svg className="bus" width="22" aria-hidden="true" focusable="false">
      <line className="trace-line" x1="5" y1="0" x2="5" y2="100%" />
      <line className="trace-line alt" x1="11" y1="0" x2="11" y2="100%" />
      <line className="trace-line" x1="17" y1="0" x2="17" y2="100%" />
      <line className="pulse alt" pathLength={100} x1="11" y1="0" x2="11" y2="100%" />
      {[8, 28, 52, 76, 94].map((y, i) => (
        <circle key={y} className={i % 2 ? 'node alt' : 'node'} cx={[5, 11, 17, 11, 5][i]} cy={`${y}%`} r="3.5" />
      ))}
    </svg>
  )
})
