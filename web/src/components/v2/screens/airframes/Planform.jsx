import React, { useId, useMemo } from 'react';

/**
 * Parametric top-view aircraft "blueprint" renderer.
 *
 * Given real overall length + span (metres) and a light `shape` descriptor,
 * it synthesises a to-scale planform: tapered fuselage, swept wings, engine
 * nacelles / propeller discs, horizontal + vertical tail, or (for `heli`) a
 * rotor disc + boom. Everything is derived from the numbers, so proportions,
 * sweep and engine layout match the actual type — no bitmap assets.
 *
 * Drawn nose-up. Stroke uses `color`; the whole thing sits on a blueprint grid
 * with dimension callouts for span (bottom) and length (left).
 *
 * @param {object} props
 * @param {number} props.length   Overall length (m)
 * @param {number} props.span     Wingspan / rotor diameter (m)
 * @param {object} props.shape    Shape descriptor from airframesData
 * @param {string} props.color    Accent stroke colour
 * @param {number} [props.w]      SVG width (px)
 * @param {number} [props.h]      SVG height (px)
 * @param {boolean} [props.detailed]  Draw the full engineering-drawing overlay
 *   (numbered feature callouts, scale bar + title block).
 * @param {string} [props.label]  Type designator shown in the title block
 */
export function Planform({
  length,
  span,
  shape,
  color,
  w = 300,
  h = 234,
  detailed = false,
  label,
}) {
  const uid = useId().replace(/[:]/g, '');
  const geo = useMemo(
    () => buildGeometry({ length, span, shape, w, h, detailed }),
    [length, span, shape, w, h, detailed]
  );

  return (
    <svg
      className={`v2-af__svg${detailed ? ' v2-af__svg--detailed' : ''}`}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Top-view planform, ${length} m long, ${span} m span`}
      style={{ '--af-line': color }}
    >
      <defs>
        <pattern id={`grid-${uid}`} width="14" height="14" patternUnits="userSpaceOnUse">
          <path d="M14 0H0V14" fill="none" stroke="var(--bord)" strokeWidth="0.5" opacity="0.6" />
        </pattern>
        {detailed && (
          <pattern id={`fine-${uid}`} width="7" height="7" patternUnits="userSpaceOnUse">
            <path d="M7 0H0V7" fill="none" stroke="var(--bord)" strokeWidth="0.35" opacity="0.35" />
          </pattern>
        )}
        <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.16" />
          <stop offset="1" stopColor={color} stopOpacity="0.04" />
        </linearGradient>
        <marker
          id={`arw-${uid}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 1 L9 5 L0 9" fill="none" stroke="var(--af-line)" strokeWidth="1.4" />
        </marker>
      </defs>

      {/* blueprint grid + centreline */}
      {detailed && <rect x="0" y="0" width={w} height={h} fill={`url(#fine-${uid})`} />}
      <rect x="0" y="0" width={w} height={h} fill={`url(#grid-${uid})`} />
      <line className="v2-af__axis" x1={geo.cx} y1={geo.top - 6} x2={geo.cx} y2={geo.bottom + 6} />

      {/* airframe */}
      <g fill={`url(#fill-${uid})`} stroke={color} strokeWidth="1.4" strokeLinejoin="round">
        {geo.shapes.map((s, i) =>
          s.type === 'path' ? (
            <path key={i} d={s.d} />
          ) : s.type === 'ellipse' ? (
            <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} />
          ) : (
            <circle
              key={i}
              cx={s.cx}
              cy={s.cy}
              r={s.r}
              fill="none"
              strokeDasharray={s.dash || undefined}
              opacity={s.opacity ?? 1}
            />
          )
        )}
      </g>

      {/* dimension callouts */}
      <DimSpan geo={geo} span={span} arrow={detailed ? `url(#arw-${uid})` : undefined} />
      <DimLength geo={geo} length={length} arrow={detailed ? `url(#arw-${uid})` : undefined} />

      {detailed && (
        <TechOverlay
          geo={geo}
          shape={shape}
          span={span}
          length={length}
          label={label}
          w={w}
          h={h}
        />
      )}
    </svg>
  );
}

/**
 * Engineering-drawing overlay: numbered leader-line callouts for the salient
 * features, a metric scale bar and a drafting title block. Anchor points are
 * derived from the bounding frame + shape descriptor, so they track the drawn
 * planform without re-deriving its exact geometry.
 */
function TechOverlay({ geo, shape, span, length, label, w, h }) {
  const { cx, top, bottom, left, right, scale } = geo;
  const L = bottom - top;
  const isHeli = shape.kind === 'heli';
  const notes = [];

  if (isHeli) {
    notes.push({
      x: right - (right - cx) * 0.5,
      y: top + L * 0.42,
      text: `${shape.blades}-BLADE MAIN ROTOR`,
      side: 'r',
    });
    notes.push({
      x: cx + (right - cx) * 0.12,
      y: bottom - L * 0.06,
      text: 'TAIL ROTOR',
      side: 'r',
    });
    notes.push({ x: cx - 6, y: top + L * 0.6, text: `⌀ ${fmt(span)} m DISC`, side: 'l' });
  } else {
    const semi = (right - left) / 2;
    // ① wing sweep, anchored on the right leading edge
    notes.push({
      x: cx + semi * 0.62,
      y: top + L * (shape.kind === 'fighter' ? 0.58 : 0.56),
      text: `Λ¼c ≈ ${shape.sweep ?? 0}°`,
      side: 'r',
    });
    // ② powerplant / mount
    const engText =
      shape.mount === 'nose'
        ? '1× TRACTOR PROP'
        : `${shape.engines || 0}× ${shape.kind === 'prop' ? 'TURBOPROP' : shape.kind === 'fighter' ? 'AB TURBOFAN' : 'TURBOFAN'}`;
    const engAnchor =
      shape.mount === 'nose'
        ? { x: cx - 6, y: top + L * 0.03 }
        : shape.mount === 'aft'
          ? { x: cx - semi * 0.16, y: top + L * 0.7 }
          : { x: cx - semi * 0.34, y: top + L * 0.5 };
    notes.push({ ...engAnchor, text: engText, side: 'l' });
    // ③ empennage
    notes.push({
      x: cx + semi * 0.14,
      y: bottom - L * 0.05,
      text:
        shape.tail === 't'
          ? 'T-TAIL'
          : shape.tail === 'twin'
            ? 'TWIN VERT. STAB.'
            : 'CONV. EMPENNAGE',
      side: 'r',
    });
    // ④ high/low wing note when present
    if (shape.wing) {
      notes.push({
        x: cx - semi * 0.5,
        y: top + L * 0.52,
        text: `${shape.wing === 'high' ? 'HIGH' : 'LOW'}-WING`,
        side: 'l',
      });
    }
  }

  // metric scale bar: 10 m (or 5 m for small types) reference
  const barMetres = span >= 24 ? 10 : span >= 12 ? 5 : 2;
  const barPx = barMetres * scale;
  const barY = top + 4;
  const barX = right - barPx - 4;

  return (
    <g className="v2-af__tech">
      {notes.map((n, i) => (
        <Callout key={i} n={n} idx={i + 1} w={w} />
      ))}

      {/* scale bar */}
      <g className="v2-af__scalebar">
        <line x1={barX} y1={barY} x2={barX + barPx} y2={barY} />
        <path
          className="v2-af__tick"
          d={`M${barX} ${barY - 3}v6M${barX + barPx} ${barY - 3}v6M${barX + barPx / 2} ${barY - 2}v4`}
        />
        <rect x={barX} y={barY - 2} width={barPx / 2} height="2" className="v2-af__scalefill" />
        <text x={barX + barPx / 2} y={barY + 11} className="v2-af__dimlabel">
          {barMetres} m
        </text>
      </g>

      {/* title block */}
      <g className="v2-af__titleblock" transform={`translate(${left - 2} ${bottom - 30})`}>
        <rect x="0" y="0" width="96" height="30" rx="2" />
        <line x1="0" y1="15" x2="96" y2="15" />
        <line x1="48" y1="0" x2="48" y2="15" />
        <text x="4" y="6.5" className="v2-af__tbk">
          TYPE
        </text>
        <text x="4" y="13" className="v2-af__tbv">
          {label || '—'}
        </text>
        <text x="52" y="6.5" className="v2-af__tbk">
          PROJ
        </text>
        <text x="52" y="13" className="v2-af__tbv">
          TOP · ORTHO
        </text>
        <text x="4" y="21.5" className="v2-af__tbk">
          FOOTPRINT
        </text>
        <text x="4" y="27.5" className="v2-af__tbv">
          {fmt(length)} × {fmt(span)} m
        </text>
      </g>
    </g>
  );
}

/** A single numbered leader-line callout pointing at a feature. */
function Callout({ n, idx, w }) {
  const toLeft = n.side === 'l';
  // leader runs horizontally out to a label anchored near the drawing edge
  const labelX = toLeft ? 30 : w - 30;
  const bendX = toLeft ? n.x - 14 : n.x + 14;
  const dotR = 1.7;
  const badgeX = toLeft ? labelX - 3 : labelX + 3;
  return (
    <g className="v2-af__cal">
      <path
        className="v2-af__leader"
        d={`M${n.x} ${n.y} L${bendX} ${n.y} L${labelX} ${n.y}`}
        fill="none"
      />
      <circle cx={n.x} cy={n.y} r={dotR} className="v2-af__caldot" />
      <circle cx={badgeX} cy={n.y} r="6" className="v2-af__calbadge" />
      <text x={badgeX} y={n.y + 0.5} className="v2-af__calnum">
        {idx}
      </text>
      <text
        x={toLeft ? badgeX + 9 : badgeX - 9}
        y={n.y + 0.5}
        className="v2-af__callabel"
        style={{ textAnchor: toLeft ? 'start' : 'end' }}
      >
        {n.text}
      </text>
    </g>
  );
}

/** Horizontal span dimension line along the bottom. */
function DimSpan({ geo, span, arrow }) {
  const y = geo.bottom + 16;
  return (
    <g className="v2-af__dim">
      <line x1={geo.left} y1={y} x2={geo.right} y2={y} markerStart={arrow} markerEnd={arrow} />
      <path className="v2-af__tick" d={`M${geo.left} ${y - 4}v8M${geo.right} ${y - 4}v8`} />
      <text className="v2-af__dimlabel" x={(geo.left + geo.right) / 2} y={y - 5}>
        {fmt(span)} m
      </text>
    </g>
  );
}

/** Vertical length dimension line along the left. */
function DimLength({ geo, length, arrow }) {
  const x = 15;
  return (
    <g className="v2-af__dim">
      <line x1={x} y1={geo.top} x2={x} y2={geo.bottom} markerStart={arrow} markerEnd={arrow} />
      <path className="v2-af__tick" d={`M${x - 4} ${geo.top}h8M${x - 4} ${geo.bottom}h8`} />
      <text
        className="v2-af__dimlabel"
        x={x - 6}
        y={(geo.top + geo.bottom) / 2}
        transform={`rotate(-90 ${x - 6} ${(geo.top + geo.bottom) / 2})`}
      >
        {fmt(length)} m
      </text>
    </g>
  );
}

function fmt(n) {
  return n >= 100 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, '');
}

// ── geometry ────────────────────────────────────────────────────────────────

/**
 * Build the planform as a list of SVG primitives plus a bounding frame the
 * dimension callouts hang off.
 */
function buildGeometry({ length, span, shape, w, h, detailed = false }) {
  // detailed drawings reserve more margin for callout leaders + title block
  const padX = detailed ? 46 : 30; // room for the length dim on the left
  const padTop = detailed ? 22 : 14;
  const padBottom = detailed ? 40 : 26; // room for the span dim + title block
  const drawW = w - padX * 2;
  const drawH = h - padTop - padBottom;

  const isHeli = shape.kind === 'heli';
  // Helis: `span` is rotor diameter; the drawn fuselage is shorter than the
  // rotor-inclusive length, so scale off the larger of the two footprints.
  const footLen = isHeli ? Math.max(length, span) : length;
  const scale = Math.min(drawW / span, drawH / footLen);

  const cx = w / 2;
  const L = length * scale;
  const S = span * scale;
  const noseY = padTop + (drawH - footLen * scale) / 2;
  const bottom = noseY + footLen * scale;

  const frame = {
    cx,
    top: noseY,
    bottom,
    left: cx - S / 2,
    right: cx + S / 2,
    scale,
  };

  if (isHeli) {
    return { ...frame, shapes: heliShapes({ cx, noseY, len: length * scale, rotor: S, shape }) };
  }

  const shapes = fixedWingShapes({ cx, noseY, L, S, scale, length, span, shape });
  return { ...frame, shapes };
}

/** Conventional fixed-wing: fuselage + wings + engines + empennage. */
function fixedWingShapes({ cx, noseY, L, S, scale, length, span, shape }) {
  const out = [];
  const kind = shape.kind;
  const sweep = ((shape.sweep || 0) * Math.PI) / 180;

  // fuselage width by kind (fraction of length), clamped to something sane
  const fuseRatio = kind === 'fighter' ? 0.16 : kind === 'prop' ? 0.09 : 0.075;
  const fw = Math.max(6, Math.min(L * fuseRatio, S * 0.16));
  const half = fw / 2;

  // fuselage: pointed nose, parallel body, tapered tail
  const yNose = noseY;
  const yTail = noseY + L;
  const yShoulder = yNose + L * (kind === 'fighter' ? 0.22 : 0.12);
  const yTailStart = yNose + L * (kind === 'fighter' ? 0.72 : 0.86);
  const tailHalf = kind === 'fighter' ? half * 0.5 : half * 0.28;
  out.push({
    type: 'path',
    d:
      `M${cx} ${yNose} ` +
      `C${cx + half * 0.7} ${yNose + L * 0.03} ${cx + half} ${yShoulder - L * 0.04} ${cx + half} ${yShoulder} ` +
      `L${cx + half} ${yTailStart} ` +
      `L${cx + tailHalf} ${yTail} L${cx - tailHalf} ${yTail} ` +
      `L${cx - half} ${yTailStart} L${cx - half} ${yShoulder} ` +
      `C${cx - half} ${yShoulder - L * 0.04} ${cx - half * 0.7} ${yNose + L * 0.03} ${cx} ${yNose} Z`,
  });

  // main wing
  const wingRootFrac = kind === 'fighter' ? 0.5 : kind === 'prop' ? 0.42 : 0.48;
  const rootLEy = yNose + L * wingRootFrac;
  const rootChord = L * (kind === 'fighter' ? 0.42 : kind === 'prop' ? 0.16 : 0.2);
  const tipChord = rootChord * (kind === 'fighter' ? 0.22 : 0.42);
  const semi = S / 2;
  const tipLEy = rootLEy + semi * Math.tan(sweep);
  out.push(wingPath(cx, half, rootLEy, rootChord, semi, tipLEy, tipChord, kind === 'fighter'));

  // engines / props
  const nEng = shape.engines || 0;
  if (shape.mount === 'wing' && nEng >= 2) {
    // nacelles slung under wing, ahead of the LE
    const stations = nEng >= 4 ? [0.32, 0.62] : [0.36];
    for (const frac of stations) {
      const ex = half + (semi - half) * frac;
      const ey = rootLEy + (tipLEy - rootLEy) * frac - fw * (kind === 'prop' ? 0 : 0.55);
      if (kind === 'prop') {
        propDisc(out, cx - ex, ey - L * 0.02, L * 0.11);
        propDisc(out, cx + ex, ey - L * 0.02, L * 0.11);
      } else {
        nacelle(out, cx - ex, ey, fw * 0.42, L * 0.11);
        nacelle(out, cx + ex, ey, fw * 0.42, L * 0.11);
      }
    }
  } else if (shape.mount === 'nose') {
    propDisc(out, cx, yNose - 1, Math.max(L * 0.16, S * 0.09));
  } else if (shape.mount === 'aft') {
    // rear-fuselage mounted nacelles
    const ey = yTailStart - L * 0.06;
    const ex = half + fw * 0.75;
    nacelle(out, cx - ex, ey, fw * 0.4, L * 0.13);
    if (nEng >= 2) nacelle(out, cx + ex, ey, fw * 0.4, L * 0.13);
  }

  // horizontal stabiliser
  const htY = yTailStart - L * (shape.tail === 't' ? 0.02 : 0.03);
  const htSemi = semi * (kind === 'fighter' ? 0.52 : 0.34);
  const htRoot = rootChord * 0.5;
  const htTip = htRoot * 0.4;
  const htSweep = Math.tan((18 * Math.PI) / 180);
  out.push(wingPath(cx, tailHalf + 1, htY, htRoot, htSemi, htY + htSemi * htSweep, htTip, false));

  // vertical fin(s) — top view: a slim centreline sliver (or twin for twin tail)
  if (shape.tail === 'twin') {
    finSliver(out, cx - htSemi * 0.7, yTailStart - L * 0.02, L * 0.14, fw * 0.28);
    finSliver(out, cx + htSemi * 0.7, yTailStart - L * 0.02, L * 0.14, fw * 0.28);
  } else {
    finSliver(out, cx, yTailStart - L * 0.03, L * 0.15, fw * 0.7);
  }

  return out;
}

/** Swept wing polygon (both sides). */
function wingPath(cx, rootHalf, rootLEy, rootChord, semi, tipLEy, tipChord, sharp) {
  const tipX = semi;
  const tipRound = sharp ? 0 : tipChord * 0.4;
  const d =
    `M${cx + rootHalf} ${rootLEy} ` +
    `L${cx + tipX} ${tipLEy} ` +
    `L${cx + tipX} ${tipLEy + tipChord - tipRound} ` +
    `L${cx + rootHalf} ${rootLEy + rootChord} ` +
    `L${cx - rootHalf} ${rootLEy + rootChord} ` +
    `L${cx - tipX} ${tipLEy + tipChord - tipRound} ` +
    `L${cx - tipX} ${tipLEy} ` +
    `L${cx - rootHalf} ${rootLEy} Z`;
  return { type: 'path', d };
}

function nacelle(out, x, y, rx, ry) {
  out.push({ type: 'ellipse', cx: x, cy: y, rx, ry });
}

function propDisc(out, x, y, r) {
  out.push({ type: 'circle', cx: x, cy: y, r, dash: '2 3', opacity: 0.9 });
  out.push({ type: 'ellipse', cx: x, cy: y, rx: r * 0.14, ry: r * 0.14 });
}

/** Vertical fin seen from above — a short forward-pointing wedge. */
function finSliver(out, x, y, len, width) {
  out.push({
    type: 'path',
    d: `M${x} ${y - len} L${x + width / 2} ${y} L${x - width / 2} ${y} Z`,
  });
}

/** Helicopter: dashed rotor disc, slim fuselage, tail boom + tail rotor. */
function heliShapes({ cx, noseY, len, rotor, shape }) {
  const out = [];
  const fuseW = rotor * 0.2;
  const cabinLen = len * 0.5;
  const cabinTop = noseY + rotor * 0.18;
  const hubY = cabinTop + cabinLen * 0.35;

  // cabin (rounded body)
  out.push({
    type: 'path',
    d:
      `M${cx} ${cabinTop} ` +
      `C${cx + fuseW / 2} ${cabinTop} ${cx + fuseW / 2} ${cabinTop + cabinLen * 0.4} ${cx + fuseW / 2} ${cabinTop + cabinLen * 0.55} ` +
      `L${cx + fuseW * 0.28} ${cabinTop + cabinLen} L${cx - fuseW * 0.28} ${cabinTop + cabinLen} ` +
      `L${cx - fuseW / 2} ${cabinTop + cabinLen * 0.55} ` +
      `C${cx - fuseW / 2} ${cabinTop + cabinLen * 0.4} ${cx - fuseW / 2} ${cabinTop} ${cx} ${cabinTop} Z`,
  });

  // tail boom
  const boomTop = cabinTop + cabinLen;
  const boomBot = noseY + len;
  out.push({
    type: 'path',
    d: `M${cx - fuseW * 0.16} ${boomTop} L${cx + fuseW * 0.16} ${boomTop} L${cx + fuseW * 0.07} ${boomBot} L${cx - fuseW * 0.07} ${boomBot} Z`,
  });
  // tail rotor + horizontal stabiliser
  out.push({
    type: 'circle',
    cx: cx + fuseW * 0.32,
    cy: boomBot - fuseW * 0.1,
    r: rotor * 0.11,
    dash: '2 2',
    opacity: 0.9,
  });
  out.push({ type: 'path', d: `M${cx - rotor * 0.13} ${boomBot - fuseW * 0.35} h${rotor * 0.26}` });

  // main rotor disc + hub + blades
  const R = rotor / 2;
  out.push({ type: 'circle', cx, cy: hubY, r: R, dash: '3 4', opacity: 0.85 });
  // each drawn line is a full diameter (= 2 blades), so halve the count
  const blades = shape.blades || 2;
  const spokes = Math.max(1, Math.round(blades / 2));
  for (let i = 0; i < spokes; i++) {
    const a = (Math.PI / spokes) * i + 0.35;
    out.push({
      type: 'path',
      d: `M${cx - Math.cos(a) * R} ${hubY - Math.sin(a) * R} L${cx + Math.cos(a) * R} ${hubY + Math.sin(a) * R}`,
    });
  }
  out.push({ type: 'ellipse', cx, cy: hubY, rx: fuseW * 0.16, ry: fuseW * 0.16 });

  return out;
}
