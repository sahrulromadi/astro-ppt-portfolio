// Paper → digital, the 3D scene of the intro slide. Storyboard (story seconds):
//   -1.6  dark; a light wave powers the grid up from the centre, the scanner and server rise, papers fall in
//   0     paper forms float in a cluster
//   1.6   one by one they fly into the scanner and burst into pixels that reassemble as data cubes in a grid
//   4.7   the cubes stream into the server, leaving light trails; its LEDs fill up
//   6.55  online: flash, ripples; a wall of hologram dashboards switches on while the camera pulls back,
//         and the scanner and server sink away
//   8.6   closing line (decode + light sweep) + tagline
//   10.2  end: only ambient motion (camera drift, ripples, dust, scanner, mouse/tilt parallax) keeps going
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, DoubleSide,
  EdgesGeometry, Euler, Fog, GridHelper, Group, HalfFloatType, Line, LineBasicMaterial, LineSegments, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, PerspectiveCamera, Plane, PlaneGeometry, PMREMGenerator,
  Points, PointsMaterial, Raycaster, RingGeometry, SRGBColorSpace, Scene, Vector2, Vector3, WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const BG = 0x0d1730;
const AMBER = 0xe8a33d;
const BLUE = 0x7fa7ff;
const GRID = 0x4c6ebe;
const LED_OFF = 0x2a3b63;
const hdr = (hex: number, k: number) => new Color(hex).multiplyScalar(k); // brighter than white → picked up by the bloom

const N = 24; // paper forms
const K = 18; // pixels per form
const TRAIL = 10; // samples per cube trail
const TRAIL_DT = 0.03;
const SPARKS = 120; // cursor trail particles

const BOOT = 1.6;
const FLY_AT = 1.6, FLY = 0.8, FLY_GAP = 0.075, LAND = 0.9;
const SEND_AT = 4.7, SEND = 0.7, SEND_GAP = 0.05;
const ONLINE = SEND_AT + (N - 1) * SEND_GAP + SEND;
const SHOW_AT = 6.9; // dashboards
const SINK_AT = SHOW_AT + 0.3; // scanner and server sink back into the floor: the end is dashboards only
const TITLE_AT = 8.6;
const END = 10.2;

const GATE = new Vector3(-2, 1.4, 0);
const RACK = new Vector3(3.8, 1.4, 0);
const RACK_IN = new Vector3(3.8, 2.3, 0);
const SW = 2.4; // dashboard screen size in chart layout units, scaled up when drawn
const SH = 1.5;

// Camera keyframes [story time, position, target], framed for 16:9; narrower screens move further back.
const SHOTS: [number, [number, number, number], [number, number, number]][] = [
  [-BOOT, [1, 14, 13], [-1.5, 0, -1]],
  [0, [-7.2, 2.6, 6.2], [-4.9, 2, 0]],
  [1.8, [-5.6, 2.3, 6.4], [-3.6, 1.8, 0]],
  [3.4, [-0.8, 2, 5.6], [-1.4, 1.3, 0]],
  [5, [1.6, 3.4, 7], [1.6, 0.7, 0]],
  [6.6, [4.8, 3.2, 7.6], [3.6, 1.6, 0]],
  [8.8, [1.2, 5.4, 16.5], [1.2, 3.4, -3]],
  [12, [1.2, 6, 18], [1.2, 3.4, -3]], // last target = centre of the dashboard wall
];

// Vignette + film grain + flash, applied after OutputPass (display colours, so the grain is even in the shadows).
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFlash: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uFlash; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb *= mix(0.45, 1.0, smoothstep(0.85, 0.3, distance(vUv, vec2(0.5))));
      c.rgb += (fract(sin(dot(vUv + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.035;
      c.rgb += uFlash * vec3(1.0, 0.85, 0.6);
      gl_FragColor = c;
    }`,
};

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const ease = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*';

const texture = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

export function build(root: HTMLElement) {
  const renderer = new WebGLRenderer({ canvas: root.querySelector('canvas')! });
  const phone = innerWidth < 700; // bloom is the expensive part on phones: 1× pixels and no MSAA there
  renderer.setPixelRatio(phone ? 1 : Math.min(devicePixelRatio, 2));

  const scene = new Scene();
  scene.background = new Color(BG);
  const fog = (scene.fog = new Fog(BG, 10, 40));
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  const camera = new PerspectiveCamera(40, 1, 0.1, 200);

  const composer = new EffectComposer(renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: phone ? 0 : 4 }));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new Vector2(1, 1), 1.2, 0.55, 1));
  composer.addPass(new OutputPass());
  const film = new ShaderPass(FilmShader);
  composer.addPass(film);

  const paperTex = texture(256, 332, (g) => {
    g.fillStyle = '#f7f5ef';
    g.fillRect(0, 0, 256, 332);
    g.fillStyle = '#14213d';
    g.fillRect(24, 24, 120, 16);
    g.fillStyle = '#c9c3b4';
    [180, 150, 200, 120, 190, 160, 140].forEach((w, i) => g.fillRect(24, 64 + i * 26, w, 7));
    g.strokeStyle = '#8a6a2a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(140, 296);
    g.bezierCurveTo(160, 260, 175, 320, 195, 285);
    g.bezierCurveTo(205, 270, 215, 300, 232, 288);
    g.stroke();
  });
  const glowTex = texture(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, '#fff');
    r.addColorStop(1, 'rgb(255 255 255 / 0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
  const line = (color: Color | number, opacity = 1) => new LineBasicMaterial({ color, opacity, transparent: opacity < 1 });
  const additive = { transparent: true, blending: AdditiveBlending, depthWrite: false } as const;
  const glowing = (hex: number, k: number) => new MeshBasicMaterial({ color: hdr(hex, k), side: DoubleSide });
  const flat = (geo: BufferGeometry, mat: MeshBasicMaterial) => {
    const m = new Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    return m;
  };
  const pool = (x: number, size: number, color = AMBER) => {
    const m = flat(new PlaneGeometry(size, size), new MeshBasicMaterial({ map: glowTex, color, opacity: 0, ...additive }));
    m.position.set(x, 0.01, 0);
    scene.add(m);
    return m;
  };

  // Floor: the grid only exists inside the boot wave's radius, with a bright front.
  const reveal = { value: 0 };
  const grid = new GridHelper(80, 80, GRID, GRID);
  grid.material.transparent = true;
  grid.material.opacity = 0.3;
  grid.material.onBeforeCompile = (sh) => {
    sh.uniforms.uReveal = reveal;
    // Interpolate the position, not the distance: grid lines are long, their ends are always far from the centre.
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvXZ = transformed.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReveal;\nvarying vec2 vXZ;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat d = length(vXZ);\ndiffuseColor.a *= step(d, uReveal);\ndiffuseColor.rgb *= 1.0 + 8.0 * smoothstep(2.0, 0.0, uReveal - d);',
      );
  };
  scene.add(grid);
  const wave = flat(new RingGeometry(0.985, 1, 128), new MeshBasicMaterial({ color: hdr(BLUE, 3), side: DoubleSide, ...additive }));
  wave.position.y = 0.03;
  scene.add(wave);

  const dustPos = new Float32Array(1500 * 3).map((_, i) => (i % 3 === 0 ? rand(-20, 20) : i % 3 === 1 ? rand(0, 12) : rand(-20, 8)));
  const dustMat = new PointsMaterial({ color: BLUE, size: 0.05, transparent: true, opacity: 0 });
  const dust = new Points(new BufferGeometry().setAttribute('position', new BufferAttribute(dustPos, 3)), dustMat);
  scene.add(dust);

  // Scanner gate (rises from the floor during boot)
  const gate = new Group();
  const gateFill = new MeshBasicMaterial({ color: AMBER, side: DoubleSide, ...additive });
  const scanBar = new Mesh(new PlaneGeometry(2.4, 0.035), glowing(AMBER, 5));
  gate.add(new LineSegments(new EdgesGeometry(new PlaneGeometry(2.4, 2.4)), line(hdr(AMBER, 3))), new Mesh(new PlaneGeometry(2.4, 2.4), gateFill), scanBar);
  gate.rotation.y = Math.PI / 2;
  scene.add(gate);
  const gatePool = pool(GATE.x, 3.2);

  // Server rack: one LED per form
  const rackGeo = new BoxGeometry(1.3, 2.8, 1.1);
  const rack = new Mesh(rackGeo, new MeshStandardMaterial({ color: 0x1b2b52, metalness: 0.85, roughness: 0.35 }));
  rack.add(new LineSegments(new EdgesGeometry(rackGeo), line(hdr(BLUE, 2))));
  scene.add(rack);
  const rackPool = pool(RACK.x, 4.5);
  const ledOn = hdr(AMBER, 4);
  const ledOff = new Color(LED_OFF);
  const ledGeo = new PlaneGeometry(0.22, 0.12);
  const leds = Array.from({ length: N }, (_, i) => {
    const led = new Mesh(ledGeo, new MeshBasicMaterial({ color: LED_OFF }));
    led.position.set(-0.35 + (i % 3) * 0.35, 1.05 - Math.floor(i / 3) * 0.3, 0.551);
    rack.add(led);
    return led;
  });

  // Online ripples on the floor around the rack
  const ripples = [0, 1, 2].map(() => {
    const r = flat(new RingGeometry(0.97, 1, 96), new MeshBasicMaterial({ color: hdr(AMBER, 3), side: DoubleSide, ...additive }));
    r.position.set(RACK.x, 0.02, RACK.z);
    scene.add(r);
    return r;
  });

  // Papers (chaos) → pixels → cubes (order). Pixels and trails are one draw call each; alpha hides the idle ones.
  const paperGeo = new PlaneGeometry(0.8, 1.04);
  const paperMat = new MeshBasicMaterial({ map: paperTex, color: 0xe6e6e6, side: DoubleSide });
  const cubeGeo = new BoxGeometry(0.3, 0.3, 0.3);
  const cubeEdges = new EdgesGeometry(cubeGeo);
  const cubeLook = Object.fromEntries(
    [AMBER, BLUE].map((c) => [c, { mat: new MeshStandardMaterial({ color: c, metalness: 0.3, roughness: 0.35, emissive: c, emissiveIntensity: 0.25 }), edge: line(hdr(c, 3)) }]),
  );

  const points = (count: number, size: number) => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 4);
    const geo = new BufferGeometry().setAttribute('position', new BufferAttribute(pos, 3)).setAttribute('color', new BufferAttribute(col, 4));
    const p = new Points(geo, new PointsMaterial({ size, vertexColors: true, transparent: true, depthWrite: false }));
    p.frustumCulled = false;
    scene.add(p);
    return { pos, col, geo };
  };
  const pixels = points(N * K, 0.09);

  const SEG = (TRAIL - 1) * 2; // vertices per trail
  const trailPos = new Float32Array(N * SEG * 3);
  const trailCol = new Float32Array(N * SEG * 4);
  const trailGeo = new BufferGeometry().setAttribute('position', new BufferAttribute(trailPos, 3)).setAttribute('color', new BufferAttribute(trailCol, 4));
  const trails = new LineSegments(trailGeo, new LineBasicMaterial({ vertexColors: true, ...additive }));
  trails.frustumCulled = false;
  scene.add(trails);

  const items = Array.from({ length: N }, (_, i) => {
    const color = i % 3 ? AMBER : BLUE;
    const paper = new Mesh(paperGeo, paperMat);
    const cube = new Mesh(cubeGeo, cubeLook[color].mat);
    cube.add(new LineSegments(cubeEdges, cubeLook[color].edge));
    scene.add(paper, cube);
    const c = hdr(color, 3);
    for (let j = 0; j < K; j++) pixels.col.set([c.r, c.g, c.b, 0], (i * K + j) * 4);
    for (let j = 0; j < SEG; j++) trailCol.set([c.r, c.g, c.b, 0], (i * SEG + j) * 4);
    return {
      paper,
      cube,
      home: new Vector3(rand(-6.6, -3.4), rand(0.8, 3.6), rand(-2.5, 1.2)),
      tilt: new Euler(rand(-0.6, 0.6), rand(-0.8, 0.8), rand(-0.5, 0.5)),
      spin: rand(0.3, 0.8),
      dropAt: rand(-1.1, -0.2),
      slot: new Vector3(-0.4 + (i % 6) * 0.5, 0.2, -0.75 + Math.floor(i / 6) * 0.5),
      bits: Array.from({ length: K }, () => ({
        from: new Vector3(rand(-0.32, 0.32), rand(-0.42, 0.42), 0),
        burst: new Vector3(rand(-0.7, 0.7), rand(-0.7, 0.7), rand(-0.7, 0.7)),
        into: new Vector3(rand(-0.12, 0.12), rand(-0.12, 0.12), rand(-0.12, 0.12)),
      })),
      flyAt: FLY_AT + i * FLY_GAP,
      sendAt: SEND_AT + i * SEND_GAP,
    };
  });
  type Item = (typeof items)[number];
  const sendPos = (it: Item, time: number, out: Vector3) => {
    const s = clamp((time - it.sendAt) / SEND);
    out.lerpVectors(it.slot, RACK_IN, ease(s));
    out.y += Math.sin(s * Math.PI) * 1.6;
    return out;
  };

  // Hologram dashboards: a curved wall behind the server, switched on from the centre outwards.
  // A chart builds in with `c` (0 → 1) and keeps moving with `t`.
  const charts: ((g: Group) => (c: number, t: number) => void)[] = [
    (g) => {
      const geo = new PlaneGeometry(0.16, 1).translate(0, 0.5, 0);
      const hs = [0.3, 0.45, 0.4, 0.6, 0.55, 0.75, 0.9];
      const bars = hs.map((_, i) => {
        const m = new Mesh(geo, glowing(i === hs.length - 1 ? AMBER : BLUE, 2.5));
        m.position.set(-0.9 + i * 0.3, -SH / 2 + 0.15, 0.01);
        g.add(m);
        return m;
      });
      return (c, t) => bars.forEach((m, i) => (m.scale.y = Math.max(0.001, hs[i] * easeOut(clamp(c * 1.6 - i * 0.1)) * (1 + 0.1 * Math.sin(t * 2 + i)))));
    },
    (g) => {
      const ring = new Mesh(new RingGeometry(0.34, 0.46, 64), new MeshBasicMaterial({ color: BLUE, opacity: 0.25, side: DoubleSide, ...additive }));
      const arc = new Mesh(new RingGeometry(0.34, 0.46, 64, 1, Math.PI / 2), glowing(AMBER, 3));
      for (const m of [ring, arc]) {
        m.position.set(-0.55, -0.05, 0.01);
        g.add(m);
      }
      const rows = [0.8, 0.55, 0.65].map((w, i) => {
        const m = new Mesh(new PlaneGeometry(1, 0.07).translate(0.5, 0, 0), glowing(i ? BLUE : AMBER, 2.5));
        m.position.set(0.1, 0.25 - i * 0.28, 0.01);
        g.add(m);
        return { m, w };
      });
      return (c, t) => {
        arc.geometry.setDrawRange(0, 6 * Math.floor(64 * 0.78 * easeOut(c)));
        arc.rotation.z = -t * 0.5;
        rows.forEach(({ m, w }, i) => (m.scale.x = Math.max(0.001, w * easeOut(clamp(c * 1.5 - i * 0.15)) * (1 + 0.12 * Math.sin(t * 1.5 + i * 2)))));
      };
    },
    (g) => {
      const pts = Array.from({ length: 24 }, (_, i) => new Vector3(-1 + (i / 23) * 2, -0.5 + (i / 23) * 0.75 + Math.sin(i * 1.7) * 0.1, 0.01));
      const trend = new Line(new BufferGeometry().setFromPoints(pts), line(hdr(AMBER, 3)));
      const head = new Mesh(new OctahedronGeometry(0.05), glowing(AMBER, 6));
      const axis = new Line(new BufferGeometry().setFromPoints([new Vector3(-1, -0.58, 0.01), new Vector3(1, -0.58, 0.01)]), line(BLUE, 0.4));
      g.add(trend, head, axis);
      return (c, t) => {
        const n = Math.max(1, Math.ceil(c * pts.length));
        trend.geometry.setDrawRange(0, n);
        head.position.copy(pts[n - 1]);
        head.visible = c > 0;
        head.scale.setScalar(1 + 0.4 * Math.sin(t * 6));
      };
    },
    (g) => {
      const geo = new PlaneGeometry(0.3, 0.22);
      const off = new MeshBasicMaterial({ color: BLUE, opacity: 0.2, side: DoubleSide, ...additive });
      const on = [glowing(AMBER, 2.5), glowing(BLUE, 2.5)];
      const tiles = Array.from({ length: 15 }, (_, i) => {
        const m = new Mesh(geo, off);
        m.position.set(-0.8 + (i % 5) * 0.4, 0.3 - Math.floor(i / 5) * 0.32, 0.01);
        g.add(m);
        return { m, at: Math.random(), rate: rand(1.5, 4), lit: on[i % 3 ? 1 : 0] };
      });
      return (c, t) => tiles.forEach(({ m, at, rate, lit }) => (m.material = c > at && Math.sin(t * rate + at * 40) > -0.5 ? lit : off));
    },
    (g) => {
      const n = 48;
      const waves = [AMBER, BLUE].map((color) => {
        const pos = new Float32Array(n * 3);
        const l = new Line(new BufferGeometry().setAttribute('position', new BufferAttribute(pos, 3)), line(hdr(color, 3)));
        l.frustumCulled = false; // its points move every frame
        g.add(l);
        return { l, pos };
      });
      return (c, t) =>
        waves.forEach(({ l, pos }, k) => {
          for (let i = 0; i < n; i++) {
            const x = -1 + (i / (n - 1)) * 2;
            pos.set([x, Math.sin(x * 4 + t * 3 + k * 2) * (k ? 0.14 : 0.24) + Math.sin(x * 9 - t * 2) * 0.06, 0.01], i * 3);
          }
          l.geometry.attributes.position.needsUpdate = true;
          l.geometry.setDrawRange(0, Math.ceil(c * n));
        });
    },
  ];
  // A wall of screens centred on the final line of sight (so it stays level on screen), wrapping round the viewer:
  // each screen sits edge to edge with the one before it, turned 15° more towards the middle.
  const wall = new Group();
  wall.position.set(...SHOTS.at(-1)![2]);
  scene.add(wall);
  const SIZES = [1.5, 1.5, 2.1, 1.5, 1.5]; // centre screen biggest
  const GAP = 0.25;
  const slots = SIZES.map(() => ({ pos: new Vector3(), yaw: 0 }));
  for (const side of [-1, 1]) {
    let x = (SW * SIZES[2]) / 2; // outer edge of the screen before
    let z = 0;
    for (let k = 1; k <= 2; k++) {
      const j = 2 + side * k;
      const a = 0.26 * k;
      const w = SW * SIZES[j];
      slots[j].pos.set(side * (x + Math.cos(a) * (GAP + w / 2)), 0, z + Math.sin(a) * (GAP + w / 2));
      slots[j].yaw = -side * a;
      x += Math.cos(a) * (GAP + w);
      z += Math.sin(a) * (GAP + w);
    }
  }
  const screens = charts.map((chart, j) => {
    const { pos, yaw } = slots[j];
    const g = new Group();
    g.rotation.set(-0.12, yaw, 0, 'YXZ'); // tipped back a little to face the camera above
    const fill = new MeshBasicMaterial({ color: BLUE, opacity: 0.08, side: DoubleSide, ...additive });
    const frame = new LineSegments(new EdgesGeometry(new PlaneGeometry(SW, SH)), line(hdr(BLUE, 2.5), 0.999));
    const header = new Mesh(new PlaneGeometry(0.7, 0.05), glowing(AMBER, 3));
    header.position.set(-SW / 2 + 0.5, SH / 2 - 0.16, 0.01);
    const scan = new Mesh(new PlaneGeometry(SW, 0.025), new MeshBasicMaterial({ color: hdr(BLUE, 2.5), opacity: 0.6, ...additive }));
    scan.position.z = 0.015;
    g.add(new Mesh(new PlaneGeometry(SW, SH), fill), frame, header, scan);
    wall.add(g);
    return { g, content: chart(g), pos, fill, frame, scan, size: SIZES[j], at: SHOW_AT + Math.abs(j - 2) * 0.3 };
  });

  // Mouse: camera parallax + a spotlight and particle trail where the cursor meets the floor. Phones: tilt parallax.
  const aim = new Vector2();
  const sway = new Vector2();
  const ndc = new Vector2();
  let hover = false;
  let moved = false;
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2);
    aim.copy(ndc);
    hover = moved = true;
  });
  root.addEventListener('pointerleave', () => {
    hover = false;
    aim.set(0, 0);
  });
  addEventListener('deviceorientation', (e) => {
    if (e.gamma !== null && e.beta !== null) aim.set(clamp(e.gamma / 25, -1, 1), clamp((e.beta - 50) / 25, -1, 1));
  });
  const ray = new Raycaster();
  const floor = new Plane(new Vector3(0, 1, 0), 0);
  const hit = new Vector3();
  const spot = pool(0, 2.2, BLUE);
  const sparks = points(SPARKS, 0.07);
  const born = new Float32Array(SPARKS).fill(-99);
  const seed = new Float32Array(SPARKS * 3);
  let nextSpark = 0;
  for (let i = 0; i < SPARKS; i++) {
    const c = hdr(i % 3 ? BLUE : AMBER, 3);
    sparks.col.set([c.r, c.g, c.b, 0], i * 4);
  }

  // DOM overlays
  const captions: [number, string][] = [
    [0, 'Paper forms. Scattered spreadsheets.'],
    [1.9, 'Turned into structured data.'],
    [4.6, 'Running on one system.'],
    [6.9, 'Connected. Visible. Trusted.'],
  ];
  const caption = root.querySelector<HTMLElement>('.intro-caption')!;
  const title = root.querySelector<HTMLElement>('.intro-title')!;
  const headEl = title.querySelector<HTMLElement>('.intro-head')!;
  const words = headEl.textContent!;
  const end = root.querySelector<HTMLElement>('.intro-end')!;
  const panel = root.querySelector<HTMLElement>('.intro-panel')!;
  const status = panel.querySelector<HTMLElement>('[data-status]')!;
  const count = panel.querySelector<HTMLElement>('[data-count]')!;
  const bar = panel.querySelector<HTMLElement>('.bar span')!;
  const panelAt = new Vector3(RACK.x, 3.1, 0);
  const v = new Vector3();
  // Pins the panel above a 3D point, kept on screen; false when the point is behind the camera.
  const pin = (el: HTMLElement, at: Vector3) => {
    const p = v.copy(at).project(camera);
    const edge = el.offsetWidth / 2 + 12;
    const x = Math.min(innerWidth - edge, Math.max(edge, ((p.x + 1) / 2) * innerWidth));
    const y = Math.max(el.offsetHeight + 12, ((1 - p.y) / 2) * innerHeight);
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    return p.z < 1;
  };

  const posCurve = new CatmullRomCurve3(SHOTS.map(([, p]) => new Vector3(...p)), false, 'centripetal');
  const lookCurve = new CatmullRomCurve3(SHOTS.map(([, , l]) => new Vector3(...l)), false, 'centripetal');
  const shotAt = (time: number) => {
    let i = 0;
    while (i < SHOTS.length - 2 && time >= SHOTS[i + 1][0]) i++;
    return (i + clamp((time - SHOTS[i][0]) / (SHOTS[i + 1][0] - SHOTS[i][0]))) / (SHOTS.length - 1);
  };
  const target = new Vector3();
  const p = new Vector3();
  const q = new Vector3();
  let shown = -2;
  let stored = -1;

  const update = (t: number) => {
    const st = t - BOOT; // story time, keeps running for the ambient motion
    const s = Math.min(st, END);

    // Camera along the keyframes, plus drift, parallax and a jolt when the server comes online.
    const aspect = innerWidth / innerHeight;
    const back = Math.min(2.2, Math.max(1, 1.7 / aspect));
    const u = shotAt(st);
    lookCurve.getPoint(u, target);
    posCurve.getPoint(u, p);
    p.sub(target).multiplyScalar(back);
    p.y *= 1 + (back - 1) * 1.2; // portrait: look down more steeply so the set spreads over the tall screen
    sway.lerp(aim, 0.05);
    const jolt = s >= ONLINE ? Math.exp(-(s - ONLINE) * 5) * 0.12 : 0;
    camera.position.copy(target).add(p);
    camera.position.x += (Math.sin(t * 0.35) * 0.25 + sway.x * 0.9) * back + Math.sin(t * 61) * jolt;
    camera.position.y += sway.y * 0.6 * back + Math.sin(t * 47) * jolt;
    camera.aspect = aspect;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    const dist = camera.position.distanceTo(target);
    fog.near = dist * 0.8;
    fog.far = dist * 2.6;
    film.uniforms.uTime.value = t;
    film.uniforms.uFlash.value = 0.35 * Math.exp(-(((s - ONLINE) / 0.09) ** 2));

    // Boot: the wave reveals the grid and raises the gate and rack.
    const r = 60 * clamp((st + 1.5) / 2) ** 2;
    reveal.value = r;
    wave.visible = r > 0 && r < 60;
    wave.scale.setScalar(Math.max(0.001, r));
    wave.material.opacity = 1 - r / 60;
    dustMat.opacity = 0.6 * clamp(st + 1);
    const gone = 1 - ease(clamp((s - SINK_AT) / 0.6));
    const gateUp = easeOut(clamp((r - 2) / 2)) * gone;
    const rackUp = easeOut(clamp((r - 3.8) / 2)) * gone;
    gate.visible = gateUp > 0.001;
    gate.scale.set(1, Math.max(0.001, gateUp), 1);
    gate.position.set(GATE.x, GATE.y * gateUp, GATE.z);
    rack.visible = rackUp > 0.001;
    rack.scale.set(1, Math.max(0.001, rackUp), 1);
    rack.position.set(RACK.x, RACK.y * rackUp, RACK.z);
    dust.rotation.y = t * 0.02;

    let done = 0;
    let pulse = 0;
    items.forEach((it, i) => {
      const { paper, cube, home, tilt, spin, slot } = it;
      const arrive = it.flyAt + FLY;
      const fall = easeOut(clamp((s - it.dropAt) / 0.9));
      const fly = clamp((s - it.flyAt) / FLY);
      const land = (s - arrive) / LAND;
      const send = clamp((s - it.sendAt) / SEND);
      pulse += Math.exp(-(((s - arrive) / 0.08) ** 2));

      paper.visible = fall > 0 && fly < 1;
      if (paper.visible) {
        const e = ease(fly);
        const a = 1 - e;
        const tumble = (1 - fall) * 8;
        paper.position.lerpVectors(home, GATE, e);
        paper.position.y += Math.sin(t * 1.3 + i) * 0.12 * a + (1 - fall) * 9;
        paper.rotation.set(tilt.x * a + Math.sin(t * spin) * 0.3 * a + tumble, tilt.y * a + t * spin * a + tumble * spin, tilt.z * a);
        paper.scale.setScalar(1 - 0.2 * e);
      }

      const live = land >= 0 && land < 1;
      it.bits.forEach((b, j) => {
        const n = i * K + j;
        pixels.col[n * 4 + 3] = live ? Math.min(1, (1 - land) / 0.15) : 0;
        if (!live) return;
        const m = ease(clamp((land - 0.2) / 0.8));
        p.copy(GATE).add(b.from).addScaledVector(b.burst, easeOut(clamp(land / 0.3)));
        p.lerp(q.copy(slot).add(b.into), m);
        p.y += Math.sin(m * Math.PI) * 0.5;
        pixels.pos.set([p.x, p.y, p.z], n * 3);
      });

      const built = clamp((land - 0.55) / 0.45);
      cube.visible = built > 0 && send < 1;
      if (cube.visible) {
        if (send === 0) {
          cube.position.copy(slot);
          cube.position.y += Math.sin(t * 3 + i) * 0.03;
          cube.rotation.y = (1 - built) * Math.PI;
          cube.scale.setScalar(easeOut(built));
        } else {
          sendPos(it, s, cube.position);
          cube.rotation.y = send * Math.PI * 2;
          cube.scale.setScalar(1 - 0.6 * ease(send));
        }
      }

      const trailing = s > it.sendAt && s < it.sendAt + SEND + TRAIL * TRAIL_DT;
      for (let j = 0; j < TRAIL - 1; j++) {
        const n = i * SEG + j * 2;
        trailCol[n * 4 + 3] = trailing ? 1 - j / TRAIL : 0;
        trailCol[n * 4 + 7] = trailing ? 1 - (j + 1) / TRAIL : 0;
        if (!trailing) continue;
        sendPos(it, s - j * TRAIL_DT, p);
        sendPos(it, s - (j + 1) * TRAIL_DT, q);
        trailPos.set([p.x, p.y, p.z, q.x, q.y, q.z], n * 3);
      }

      if (send === 1) done++;
      leds[i].material.color.copy(send === 1 ? ledOn : ledOff);
    });
    pixels.geo.attributes.position.needsUpdate = pixels.geo.attributes.color.needsUpdate = true;
    trailGeo.attributes.position.needsUpdate = trailGeo.attributes.color.needsUpdate = true;

    gateFill.opacity = 0.04 + Math.min(1, pulse) * 0.12;
    scanBar.position.y = Math.sin(t * 4) * 1.15;
    gatePool.material.opacity = 0.35 * gateUp;
    rackPool.material.opacity = (0.15 + (done / N) * 0.45) * rackUp;
    ripples.forEach((ring, j) => {
      const k = (s - ONLINE - j * 0.6) / 1.8; // one shock wave, three rings
      ring.visible = k > 0 && k < 1;
      ring.scale.setScalar(0.8 + k * 9);
      ring.material.opacity = (1 - k) ** 2 * 0.8;
    });

    screens.forEach(({ g, content, pos, fill, frame, scan, size, at }, j) => {
      const wide = clamp((s - at) / 0.25); // CRT switch-on: a line first, then it opens up
      const tall = clamp((s - at - 0.25) / 0.25);
      const age = s - at - 0.5;
      g.visible = wide > 0;
      g.position.set(pos.x, pos.y + Math.sin(st * 1.2 + j) * 0.08, pos.z);
      g.scale.set(Math.max(0.001, easeOut(wide)) * size, Math.max(0.02, easeOut(tall)) * size, size);
      const flicker = age > 0 && age < 0.45 && Math.random() < 0.35 ? 0.25 : 1; // hologram settling in
      frame.material.opacity = flicker;
      fill.opacity = 0.08 * flicker;
      scan.visible = age > 0;
      scan.position.y = SH / 2 - ((st * 0.35 + j * 0.27) % 1) * SH;
      content(clamp(age / 1.4), st);
    });

    // Cursor spotlight + trail
    ray.setFromCamera(ndc, camera);
    const onFloor = hover && ray.ray.intersectPlane(floor, hit) !== null;
    spot.visible = onFloor;
    if (onFloor) {
      spot.position.set(hit.x, 0.02, hit.z);
      spot.material.opacity = 0.6;
      if (moved) {
        for (let k = 0; k < 2; k++) {
          const i = nextSpark++ % SPARKS;
          born[i] = t;
          seed.set([hit.x + rand(-0.2, 0.2), 0.05, hit.z + rand(-0.2, 0.2)], i * 3);
        }
        moved = false;
      }
    }
    for (let i = 0; i < SPARKS; i++) {
      const age = t - born[i];
      sparks.col[i * 4 + 3] = clamp(1 - age / 1.1);
      sparks.pos.set([seed[i * 3], seed[i * 3 + 1] + age * 0.7, seed[i * 3 + 2]], i * 3);
    }
    sparks.geo.attributes.position.needsUpdate = sparks.geo.attributes.color.needsUpdate = true;

    // Overlays
    const c = captions.findLastIndex(([at]) => s >= at);
    if (c !== shown) {
      shown = c;
      caption.textContent = c < 0 ? '' : captions[c][1];
      caption.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 450);
    }
    title.classList.toggle('on', s >= TITLE_AT);
    const decoded = (s - TITLE_AT) / 0.9; // letters lock in left to right
    const text = decoded >= 1 || decoded < 0 ? words : [...words].map((ch, i) => (ch === ' ' || i / words.length < decoded * 1.4 - 0.4 ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('');
    if (headEl.textContent !== text) headEl.textContent = text;
    end.classList.toggle('on', st >= END);
    panel.classList.toggle('on', pin(panel, panelAt) && s >= SEND_AT - 0.3 && s < SHOW_AT); // the dashboards take over
    if (done !== stored) {
      stored = done;
      count.textContent = `${done} / ${N}`;
      bar.style.transform = `scaleX(${done / N})`;
      status.textContent = done === N ? 'Online' : 'Syncing';
    }
  };

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    wall.scale.setScalar(Math.min(1, (innerWidth / innerHeight) * 1.35)); // portrait: shrink the wall to fit the width
  };
  resize();
  addEventListener('resize', resize);

  let raf = 0;
  let t0 = 0;
  let last = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - t0 > (BOOT + END) * 1000 && now - last < 30) return; // story over: the ambient loop runs at ~30 fps
    last = now;
    update((now - t0) / 1000);
    composer.render();
  };
  const start = () => {
    t0 = performance.now();
    raf ||= requestAnimationFrame(frame);
  };
  root.querySelector('.intro-replay')!.addEventListener('click', start);
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  return {
    play() {
      if (raf) return;
      if (!still.matches) return start();
      update(BOOT + END); // reduced motion: show the end state; Replay still plays it on request
      composer.render();
    },
    pause() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
