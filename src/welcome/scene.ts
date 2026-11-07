// Hero scene: four platform cables carry data pulses into the dashboard screenshot,
// over a field of particles that sits at different depths for parallax.
// Everything is laid out in CSS pixels: at z = 0 one world unit is one pixel, so the
// cables line up exactly with the HTML platform chips and the screenshot frame.
import {
  BufferAttribute,
  BufferGeometry,
  CubicBezierCurve3,
  Group,
  Line,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three'

type Options = {
  fx: HTMLElement // absolutely positioned layer that holds the canvas and the chips
  canvas: HTMLCanvasElement
  stage: HTMLElement // wrapper of the screenshot frame (its top sets the canvas height)
  frame: HTMLElement // the screenshot frame the cables plug into
  reduce: boolean
}

type Cable = {
  node: HTMLElement
  at: number // where along the frame's top edge the cable lands, 0 to 1
  offset: number // phase so the pulses do not all leave together
  curve: CubicBezierCurve3
  geo: BufferGeometry
  mat: ShaderMaterial
  line: Line
}

const FOV = 35
const SEGMENTS = 72
const PERIOD = 3600 // ms for one pulse to travel and land

// Shaders write sRGB values straight to the screen, so colours are given as 0 to 1 sRGB.
const rgb = (s: string) => new Vector3(...s.split(',').map((n) => Number(n) / 255))

const cableVert = /* glsl */ `
  attribute float t;
  varying float vT;
  void main() {
    vT = t;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const cableFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHead;
  varying float vT;
  void main() {
    float d = uHead - vT;
    float trail = d >= 0.0 ? exp(-d * 8.0) : 0.0;
    gl_FragColor = vec4(uColor, 0.16 + trail * 0.7);
  }`

const sparkVert = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
  }`
const sparkFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.2, 0.1, d);
    float halo = smoothstep(0.5, 0.0, d) * 0.35;
    gl_FragColor = vec4(vColor, (core + halo) * vAlpha);
  }`

const dustVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aTint;
  uniform float uScale;
  uniform float uPixelRatio;
  uniform float uTime;
  varying float vAlpha;
  varying float vTint;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.0004 + position.x * 0.01) * 6.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (uScale / -mv.z);
    vAlpha = aAlpha;
    vTint = aTint;
  }`
const dustFrag = /* glsl */ `
  varying float vAlpha;
  varying float vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    vec3 ink = vec3(0.04);
    vec3 accent = vec3(0.31, 0.275, 0.898);
    gl_FragColor = vec4(mix(ink, accent, vTint), smoothstep(0.5, 0.3, d) * vAlpha);
  }`

export function startHeroScene({ fx, canvas, stage, frame, reduce }: Options) {
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' })
  } catch {
    canvas.remove() // No WebGL: the page still works, the chips just float without cables.
    return
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(dpr)
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const camera = new PerspectiveCamera(FOV, 1, 1, 6000)
  let w = 1
  let h = 1

  // ---------- Particle field ----------
  const small = window.matchMedia('(max-width: 860px)').matches
  const count = small ? 140 : 380
  const dustPos = new Float32Array(count * 3)
  const dustSize = new Float32Array(count)
  const dustAlpha = new Float32Array(count)
  const dustTint = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 2400
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 1400
    dustPos[i * 3 + 2] = -700 + Math.random() * 950
    dustSize[i] = 1.5 + Math.random() * 2.5
    dustAlpha[i] = 0.1 + Math.random() * 0.22
    dustTint[i] = Math.random() < 0.2 ? 1 : 0
  }
  const dustGeo = new BufferGeometry()
  dustGeo.setAttribute('position', new BufferAttribute(dustPos, 3))
  dustGeo.setAttribute('aSize', new BufferAttribute(dustSize, 1))
  dustGeo.setAttribute('aAlpha', new BufferAttribute(dustAlpha, 1))
  dustGeo.setAttribute('aTint', new BufferAttribute(dustTint, 1))
  const dustMat = new ShaderMaterial({
    uniforms: { uScale: { value: 1 }, uPixelRatio: { value: dpr }, uTime: { value: 0 } },
    vertexShader: dustVert,
    fragmentShader: dustFrag,
    transparent: true,
    depthWrite: false,
  })
  const dust = new Group()
  dust.add(new Points(dustGeo, dustMat))
  scene.add(dust)

  // ---------- Cables ----------
  const nodes = [...fx.querySelectorAll<HTMLElement>('[data-node]')]
  const cables: Cable[] = nodes.map((node, i) => {
    const geo = new BufferGeometry()
    const t = new Float32Array(SEGMENTS + 1)
    for (let s = 0; s <= SEGMENTS; s++) t[s] = s / SEGMENTS
    geo.setAttribute('position', new BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3))
    geo.setAttribute('t', new BufferAttribute(t, 1))
    const mat = new ShaderMaterial({
      uniforms: { uColor: { value: rgb(node.dataset.rgb ?? '79,70,229') }, uHead: { value: -1 } },
      vertexShader: cableVert,
      fragmentShader: cableFrag,
      transparent: true,
      depthWrite: false,
    })
    const line = new Line(geo, mat)
    line.frustumCulled = false
    scene.add(line)
    return {
      node, geo, mat, line,
      at: Number(node.dataset.at ?? 0.5),
      offset: i / nodes.length,
      curve: new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3()),
    }
  })

  // One point per cable for the travelling pulse, one per cable for the port it lands in.
  const sparkCount = cables.length * 2
  const sparkPos = new Float32Array(sparkCount * 3)
  const sparkColor = new Float32Array(sparkCount * 3)
  const sparkSize = new Float32Array(sparkCount)
  const sparkAlpha = new Float32Array(sparkCount)
  cables.forEach((c, i) => {
    const col = c.mat.uniforms.uColor.value as Vector3
    for (const k of [i, i + cables.length]) sparkColor.set([col.x, col.y, col.z], k * 3)
  })
  const sparkGeo = new BufferGeometry()
  sparkGeo.setAttribute('position', new BufferAttribute(sparkPos, 3))
  sparkGeo.setAttribute('aColor', new BufferAttribute(sparkColor, 3))
  sparkGeo.setAttribute('aSize', new BufferAttribute(sparkSize, 1))
  sparkGeo.setAttribute('aAlpha', new BufferAttribute(sparkAlpha, 1))
  const sparks = new Points(sparkGeo, new ShaderMaterial({
    uniforms: { uPixelRatio: { value: dpr } },
    vertexShader: sparkVert,
    fragmentShader: sparkFrag,
    transparent: true,
    depthWrite: false,
  }))
  sparks.frustumCulled = false
  scene.add(sparks)

  // ---------- Layout ----------
  const resize = () => {
    // Reach just past the top of the screenshot; extra room covers the intro, when it starts lower.
    const stageTop = stage.getBoundingClientRect().top - fx.getBoundingClientRect().top
    fx.style.height = `${Math.round(stageTop + 120)}px`
    w = Math.max(1, fx.clientWidth)
    h = Math.max(1, fx.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.position.z = h / 2 / Math.tan((FOV * Math.PI) / 360)
    camera.updateProjectionMatrix()
    dustMat.uniforms.uScale.value = camera.position.z
  }

  const tmp = new Vector3()
  const toWorld = (v: Vector3, x: number, y: number) => v.set(x - w / 2, h / 2 - y, 0)

  // Re-read the chip and frame positions each frame: the chips float and the frame tilts on scroll.
  const placeCables = () => {
    const box = fx.getBoundingClientRect()
    const fr = frame.getBoundingClientRect()
    cables.forEach((c) => {
      const r = c.node.getBoundingClientRect()
      c.line.visible = r.width > 0
      if (!c.line.visible) return
      const sx = r.left + r.width / 2 - box.left
      const sy = r.bottom - box.top
      const tx = fr.left - box.left + fr.width * c.at
      const ty = fr.top - box.top
      const bend = (ty - sy) * 0.55
      toWorld(c.curve.v0, sx, sy)
      toWorld(c.curve.v1, sx, sy + bend)
      toWorld(c.curve.v2, tx, ty - bend)
      toWorld(c.curve.v3, tx, ty)
      const pos = c.geo.attributes.position as BufferAttribute
      for (let s = 0; s <= SEGMENTS; s++) {
        c.curve.getPoint(s / SEGMENTS, tmp)
        pos.setXYZ(s, tmp.x, tmp.y, tmp.z)
      }
      pos.needsUpdate = true
    })
  }

  const placeSparks = (now: number) => {
    const posAttr = sparkGeo.attributes.position as BufferAttribute
    cables.forEach((c, i) => {
      const port = i + cables.length
      if (!c.line.visible) {
        sparkAlpha[i] = 0
        sparkAlpha[port] = 0
        return
      }
      const head = reduce ? -1 : (((now / PERIOD) + c.offset) % 1) * 1.35
      c.mat.uniforms.uHead.value = head
      // Pulse: fades in as it leaves the chip, disappears when it lands.
      if (head >= 0 && head <= 1) {
        c.curve.getPoint(head, tmp)
        posAttr.setXYZ(i, tmp.x, tmp.y, 0)
        sparkSize[i] = 10
        sparkAlpha[i] = Math.min(1, head * 12)
      } else {
        sparkAlpha[i] = 0
      }
      // Port: flares briefly each time a pulse lands.
      const flare = head > 1 ? Math.exp(-(head - 1) * 14) : 0
      posAttr.setXYZ(port, c.curve.v3.x, c.curve.v3.y, 0)
      sparkSize[port] = 8 + flare * 12
      sparkAlpha[port] = 0.6 + flare * 0.4
    })
    posAttr.needsUpdate = true
    sparkGeo.attributes.aSize.needsUpdate = true
    sparkGeo.attributes.aAlpha.needsUpdate = true
  }

  // ---------- Pointer and scroll parallax ----------
  const target = { x: 0, y: 0 }
  const current = { x: 0, y: 0 }
  if (!reduce) {
    window.addEventListener('pointermove', (e) => {
      target.x = (e.clientX / window.innerWidth) * 2 - 1
      target.y = (e.clientY / window.innerHeight) * 2 - 1
    }, { passive: true })
  }

  const render = (now: number) => {
    current.x += (target.x - current.x) * 0.05
    current.y += (target.y - current.y) * 0.05
    dust.rotation.y = Math.sin(now * 0.00015) * 0.05 + current.x * 0.08
    dust.rotation.x = current.y * 0.05
    // The field drifts down inside the hero as the page scrolls, so it reads as further away.
    dust.position.y = reduce ? 0 : -window.scrollY * 0.35
    dustMat.uniforms.uTime.value = reduce ? 0 : now
    placeCables()
    placeSparks(now)
    renderer.render(scene, camera)
  }

  // ---------- Loop: only while the hero is on screen and the tab is visible ----------
  let onScreen = true
  let raf = 0
  const loop = (now: number) => {
    raf = 0
    if (!onScreen || document.hidden) return
    render(now)
    raf = requestAnimationFrame(loop)
  }
  const kick = () => {
    if (reduce) render(0)
    else if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(loop)
  }
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting
    kick()
  }).observe(fx)
  document.addEventListener('visibilitychange', kick)

  const hero = fx.parentElement ?? fx
  new ResizeObserver(() => {
    resize()
    kick()
  }).observe(hero)
  resize()
  kick()
}
