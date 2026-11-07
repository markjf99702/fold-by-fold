// Draws the paper in WebGL: two-sided sheets with a little paper grain, the edges of every layer,
// a cutting mat with the paper's shadow on it, and the diagram marks (fold lines and arrows).

import { corners } from './motion.js';

const PAPER_VS = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec2 aUv;
uniform mat4 uViewProj;
varying vec3 vNormal; varying vec2 vUv; varying vec3 vPos;
void main() { vNormal = aNormal; vUv = aUv; vPos = aPos; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

const PAPER_FS = `
precision mediump float;
uniform vec3 uFront; uniform vec3 uBack; uniform vec3 uLight; uniform vec3 uEye;
varying vec3 vNormal; varying vec2 vUv; varying vec3 vPos;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec3 n = normalize(vNormal);
  vec3 base = uFront;
  if (!gl_FrontFacing) { n = -n; base = uBack; }
  float grain = noise(vUv * 180.0) * 0.5 + noise(vUv * 37.0) * 0.5;
  float diff = max(dot(n, normalize(uLight)), 0.0);
  float sky = 0.5 + 0.5 * n.z;
  vec3 v = normalize(uEye - vPos);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  // A room's light: soft enough that paper turned from the lamp, or seen from underneath, keeps its colour, and
  // flat paper facing up as bright as ever.
  vec3 col = base * (0.60 + 0.10 * sky + 0.40 * diff) * (0.965 + 0.05 * grain);
  col += vec3(0.05) * rim;
  gl_FragColor = vec4(col, 1.0);
}`;

const FLAT_VS = `
attribute vec3 aPos; attribute vec4 aColor; attribute float aS;
uniform mat4 uViewProj;
varying vec4 vColor; varying float vS;
void main() { vColor = aColor; vS = aS; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

// aS is distance along a line, for dashes: uDash 0 solid, 1 dashed (valley), 2 dash-dot (mountain).
const FLAT_FS = `
precision mediump float;
uniform float uDash; uniform float uAlpha;
varying vec4 vColor; varying float vS;
void main() {
  if (uDash > 0.5) {
    float period = uDash > 1.5 ? 0.066 : 0.05;
    float x = mod(vS, period);
    if (uDash < 1.5) { if (x > 0.031) discard; }
    else { if (!(x < 0.03 || (x > 0.042 && x < 0.052))) discard; }
  }
  float a = vColor.a * uAlpha;
  gl_FragColor = vec4(vColor.rgb * a, a); // premultiplied, like everything drawn here
}`;

const MAT_VS = `
attribute vec3 aPos; uniform mat4 uViewProj; varying vec2 vP;
void main() { vP = aPos.xy; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

// The mat reaches far enough to fill the view up to the horizon from a low angle, fading out only at its far
// edge; its grid fades sooner, before its lines get too fine to draw steadily.
const MAT_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uMat; uniform vec3 uLine; uniform vec2 uCenter; uniform float uFade;
varying vec2 vP;
float gridLine(vec2 p, float step, float w) {
  vec2 g = abs(fract(p / step - 0.5) - 0.5) * step;
  return 1.0 - smoothstep(0.0, w, min(g.x, g.y));
}
void main() {
  float d = length(vP - uCenter);
  float grid = 1.0 - smoothstep(2.0, 5.0, d);
  float minor = gridLine(vP, 0.1, 0.0022) * 0.35 * (1.0 - smoothstep(1.2, 3.0, d));
  float major = gridLine(vP, 0.5, 0.004);
  vec3 col = mix(uMat, uLine, max(minor, major) * grid);
  float a = 1.0 - smoothstep(uFade * 0.5, uFade, d);
  gl_FragColor = vec4(col * a, a);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const loc = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < n; i++) { const a = gl.getActiveAttrib(p, i); loc[a.name] = gl.getAttribLocation(p, a.name); }
  const m = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < m; i++) { const u = gl.getActiveUniform(p, i); loc[u.name] = gl.getUniformLocation(p, u.name); }
  return { p, loc };
}

// ---------- Small vector and matrix helpers ----------
const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

function lookAt(eye, target, up) {
  const z = v3.norm(v3.sub(eye, target));
  const x = v3.norm(v3.cross(up, z));
  const y = v3.cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1];
}

function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

export function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ---------- The view ----------

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true, stencil: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    this.init();
    // A graphics card reset, or a phone reclaiming the 3D from a tab in the background, loses everything on
    // the card. Asking to have it back, and making it again when it comes, brings the paper back.
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => this.init());
    this.front = hexToRgb('#d9412b');
    this.back = hexToRgb('#f3eee3');
    this.matColor = hexToRgb('#2f5a4e');
    this.matLine = hexToRgb('#4d7a6c');
    // Camera: turned about the table (yaw), tilted up from it (pitch), and how far away.
    this.cam = { yaw: -90, pitch: 58, dist: 2.2, target: [0, 0, 0] };
    this.goal = { target: [0, 0, 0], dist: 2.2, yaw: null, pitch: null };
    this.zoom = 1; // the viewer's own zoom, on top of the framing
    this.items = [];
    this.marks = null;
    this.markAlpha = 0;
  }

  // The shader programs and buffers, which live on the graphics card.
  init() {
    const gl = this.gl;
    this.paper = compile(gl, PAPER_VS, PAPER_FS);
    this.flat = compile(gl, FLAT_VS, FLAT_FS);
    this.mat = compile(gl, MAT_VS, MAT_FS);
    this.buf = {
      paper: gl.createBuffer(), edges: gl.createBuffer(), shadow: gl.createBuffer(),
      marks: gl.createBuffer(), mat: gl.createBuffer(),
    };
  }

  setPaper(front, back) {
    this.front = hexToRgb(front);
    this.back = hexToRgb(back);
  }

  setMat(color, line) {
    this.matColor = hexToRgb(color);
    this.matLine = hexToRgb(line);
  }

  // What to draw: facets with poses, and the diagram marks with how visible they are.
  show(items, marks = null, markAlpha = 0) {
    this.items = items;
    this.marks = marks;
    this.markAlpha = markAlpha;
  }

  // Frames a region of the table: centre and size, eased toward over a few frames by the caller.
  // Frames a square of the table centered on (cx, cy), raised to height cz for a model standing up.
  frame(cx, cy, size, cz = 0) {
    this.goal.target = [cx, cy, cz];
    this.goal.size = size;
  }

  // How far back the camera sits to fit the framed size across the narrower side of the view.
  fitDistance() {
    const aspect = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
    const fy = (32 * Math.PI) / 180, fx = 2 * Math.atan(Math.tan(fy / 2) * aspect);
    return ((this.goal.size || 1) * 0.62) / Math.tan(Math.min(fx, fy) / 2);
  }

  // Turn the camera to a yaw and pitch, gradually.
  aim(yaw, pitch) {
    // Go the short way round.
    let y = yaw;
    while (y - this.cam.yaw > 180) y -= 360;
    while (y - this.cam.yaw < -180) y += 360;
    this.goal.yaw = y;
    this.goal.pitch = pitch;
  }

  zoomBy(k) {
    this.zoom = Math.max(0.35, Math.min(3, this.zoom * k));
  }

  // Eases the camera toward its goal; returns true once it's there.
  settle(k = 1) {
    this.cam.target = v3.lerp(this.cam.target, this.goal.target, k);
    const dist = this.fitDistance() * this.zoom;
    this.cam.dist += (dist - this.cam.dist) * k;
    let done = Math.hypot(...v3.sub(this.cam.target, this.goal.target)) < 1e-4 && Math.abs(dist - this.cam.dist) < 1e-4;
    if (this.goal.yaw !== null) {
      this.cam.yaw += (this.goal.yaw - this.cam.yaw) * k;
      this.cam.pitch += (this.goal.pitch - this.cam.pitch) * k;
      if (Math.abs(this.goal.yaw - this.cam.yaw) < 0.05 && Math.abs(this.goal.pitch - this.cam.pitch) < 0.05) {
        this.cam.yaw = this.goal.yaw; this.cam.pitch = this.goal.pitch; this.goal.yaw = this.goal.pitch = null;
      } else done = false;
    }
    return done;
  }

  eye() {
    const { yaw, pitch, dist, target } = this.cam;
    const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
    return [target[0] + dist * Math.cos(p) * Math.cos(y), target[1] + dist * Math.cos(p) * Math.sin(y), target[2] + dist * Math.sin(p)];
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  draw() {
    const gl = this.gl;
    if (gl.isContextLost()) return; // until it comes back
    this.resize();
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const eye = this.eye();
    const up = Math.abs(this.cam.pitch) > 89.5 ? [Math.cos((this.cam.yaw + 180) * Math.PI / 180), Math.sin((this.cam.yaw + 180) * Math.PI / 180), 0] : [0, 0, 1];
    const view = lookAt(eye, this.cam.target, up);
    const proj = perspective((32 * Math.PI) / 180, W / H, 0.05, 50);
    const vp = mul4(proj, view);
    this.vp = vp;
    const below = eye[2] < 0;

    gl.enable(gl.BLEND);
    // The canvas is clear where nothing is drawn, so the mat's far edge can fade into the page. Colours are
    // premultiplied by how solid they are, so a half-clear stroke over the mat (a shadow, an edge) mixes in its
    // colour but leaves the canvas as solid as it was, and the mat's fading edge keeps its own colour rather
    // than going grey on the way out.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // The mat, and the paper's shadow on it. Seen from underneath, the mat is left out.
    if (!below) {
      gl.disable(gl.DEPTH_TEST);
      this.drawMat(vp);
      this.drawShadow(vp);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    this.drawPaper(vp, eye);
    this.drawEdges(vp);
    // The marks are drawn over everything, so from underneath they'd show through the paper, mirrored.
    if (this.marks && this.markAlpha > 0.01 && !below) {
      gl.disable(gl.DEPTH_TEST);
      this.drawMarks(vp, eye);
    }
  }

  drawMat(vp) {
    const gl = this.gl, { p, loc } = this.mat;
    const [cx, cy] = this.cam.target;
    const S = 24;
    const quad = new Float32Array([cx - S, cy - S, -0.0005, cx + S, cy - S, -0.0005, cx + S, cy + S, -0.0005,
      cx - S, cy - S, -0.0005, cx + S, cy + S, -0.0005, cx - S, cy + S, -0.0005]);
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.mat);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(loc.uViewProj, false, vp);
    gl.uniform3fv(loc.uMat, this.matColor);
    gl.uniform3fv(loc.uLine, this.matLine);
    gl.uniform2fv(loc.uCenter, [cx, cy]);
    gl.uniform1f(loc.uFade, S);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(loc.aPos);
  }

  // Each facet flattened onto the mat along the light, drawn once per pixel with the stencil.
  drawShadow(vp) {
    const gl = this.gl;
    const L = [0.28, 0.42, 1];
    const data = [];
    for (const it of this.items) {
      const c = corners(it).map((q) => [q[0] - (L[0] * q[2]) / L[2], q[1] - (L[1] * q[2]) / L[2], 0.0004]);
      for (let i = 1; i < c.length - 1; i++) {
        for (const q of [c[0], c[i], c[i + 1]]) data.push(q[0], q[1], q[2], 0.05, 0.07, 0.06, 0.22, 0);
      }
    }
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.EQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    this.drawFlat(this.buf.shadow, data, vp, 0, 1);
    gl.disable(gl.STENCIL_TEST);
  }

  drawPaper(vp, eye) {
    const gl = this.gl, { p, loc } = this.paper;
    const data = [];
    for (const it of this.items) {
      const c = corners(it);
      const r = it.pose.r;
      const n = [r[2], r[5], r[8]];
      const uv = it.facet.poly;
      for (let i = 1; i < c.length - 1; i++) {
        for (const k of [0, i, i + 1]) data.push(c[k][0], c[k][1], c[k][2], n[0], n[1], n[2], uv[k][0], uv[k][1]);
      }
    }
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.paper);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    const stride = 32;
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(loc.aNormal);
    gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(loc.aUv);
    gl.vertexAttribPointer(loc.aUv, 2, gl.FLOAT, false, stride, 24);
    gl.uniformMatrix4fv(loc.uViewProj, false, vp);
    gl.uniform3fv(loc.uFront, this.front);
    gl.uniform3fv(loc.uBack, this.back);
    gl.uniform3fv(loc.uLight, [-0.35, -0.55, 1]);
    gl.uniform3fv(loc.uEye, eye);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 8);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    for (const a of [loc.aPos, loc.aNormal, loc.aUv]) gl.disableVertexAttribArray(a);
  }

  // The edges of every facet, as thin strips lying on both faces of the paper.
  drawEdges(vp) {
    const data = [];
    const w = 0.0016;
    for (const it of this.items) {
      if (it.bridge) continue;
      const c = corners(it);
      const r = it.pose.r;
      const n = [r[2], r[5], r[8]];
      for (let i = 0; i < c.length; i++) {
        const a = c[i], b = c[(i + 1) % c.length];
        const dir = v3.norm(v3.sub(b, a));
        const side = v3.mul(v3.norm(v3.cross(n, dir)), w);
        for (const s of [1, -1]) {
          const off = v3.mul(n, 0.0006 * s);
          const a1 = v3.add(v3.add(a, side), off), a2 = v3.add(v3.sub(a, side), off);
          const b1 = v3.add(v3.add(b, side), off), b2 = v3.add(v3.sub(b, side), off);
          for (const q of [a1, b1, b2, a1, b2, a2]) data.push(q[0], q[1], q[2], 0.1, 0.08, 0.06, 0.34, 0);
        }
      }
    }
    this.drawFlat(this.buf.edges, data, vp, 0, 1);
  }

  // Fold lines on the paper, each with a curved arrow over it.
  // All the lines first, so no line's halo cuts across another fold's arrow.
  drawMarks(vp, eye) {
    const ink = [0.09, 0.11, 0.16, 1], halo = [1, 1, 1, 0.92];
    for (const m of this.marks) if (m.line) this.drawLine(m, ink, halo, vp);
    for (const m of this.marks) this.drawMark(m, vp, eye, ink, halo);
  }

  // A mark's arrow, or a symbol beside the model.
  drawMark(m, vp, eye, ink, halo) {
    if (m.path) {
      // A symbol lying flat on the table beside the model.
      const flat = (q, t) => v3.norm(v3.cross([0, 0, 1], t));
      this.drawFlat(this.buf.marks, ribbon(m.path, flat, m.arrow, halo, ink, true), vp, 0, this.markAlpha);
      this.drawFlat(this.buf.marks, ribbon(m.path, flat, m.arrow, halo, ink, false), vp, 0, this.markAlpha);
      return;
    }
    // The arrow: an arc from the moving part over the fold, facing the camera.
    if (!m.arrow) return;
    const arc = arrowPath(m.arrow);
    const facing = (q, t) => v3.norm(v3.cross(t, v3.norm(v3.sub(eye, q))));
    // A short arrow (a small tip folding) is drawn finer, so its head doesn't swamp it.
    const r = Math.hypot(m.arrow.to[0] - m.arrow.from[0], m.arrow.to[1] - m.arrow.from[1]) / 2;
    const k = Math.max(0.45, Math.min(1, r / 0.1));
    this.drawFlat(this.buf.marks, ribbon(arc, facing, m.arrow, halo, ink, true, k), vp, 0, this.markAlpha);
    this.drawFlat(this.buf.marks, ribbon(arc, facing, m.arrow, halo, ink, false, k), vp, 0, this.markAlpha);
  }

  // A fold line: a flat strip lying on the paper, dashed for a valley fold and dash-dotted for a mountain fold.
  drawLine(m, ink, halo, vp) {
    const [a, b] = m.line;
    const dir = v3.norm(v3.sub(b, a));
    const side = v3.cross([0, 0, 1], dir);
    const lineData = (w, color) => {
      const out = [];
      const s = v3.mul(side, w), L = Math.hypot(...v3.sub(b, a));
      const a1 = v3.add(a, s), a2 = v3.sub(a, s), b1 = v3.add(b, s), b2 = v3.sub(b, s);
      for (const [q, t] of [[a1, 0], [b1, L], [b2, L], [a1, 0], [b2, L], [a2, 0]]) out.push(q[0], q[1], q[2], ...color, t);
      return out;
    };
    // Opening a fold needs no line: the crease is the flap's own folded edge, and the arrow says to open it.
    if (!m.unfold) {
      const dash = m.type === 'mountain' ? 2 : 1;
      this.drawFlat(this.buf.marks, lineData(0.0075, halo), vp, dash, this.markAlpha);
      this.drawFlat(this.buf.marks, lineData(0.0042, ink), vp, dash, this.markAlpha);
    }
  }

  drawFlat(buffer, data, vp, dash, alpha) {
    if (!data.length) return;
    const gl = this.gl, { p, loc } = this.flat;
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    const stride = 32;
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(loc.aColor);
    gl.vertexAttribPointer(loc.aColor, 4, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(loc.aS);
    gl.vertexAttribPointer(loc.aS, 1, gl.FLOAT, false, stride, 28);
    gl.uniformMatrix4fv(loc.uViewProj, false, vp);
    gl.uniform1f(loc.uDash, dash);
    gl.uniform1f(loc.uAlpha, alpha);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 8);
    for (const a of [loc.aPos, loc.aColor, loc.aS]) gl.disableVertexAttribArray(a);
  }

  // Screen position (CSS pixels) of a table point, for hit tests and labels.
  project(q) {
    const m = this.vp;
    const x = m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12];
    const y = m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13];
    const w = m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15];
    return [((x / w + 1) / 2) * this.canvas.clientWidth, ((1 - y / w) / 2) * this.canvas.clientHeight];
  }
}

// Points along the arrow's arc: a half circle standing on the fold, over the paper for a valley fold and
// under it for a mountain fold, ending short of the target so the head sits on it.
function arrowPath(ar) {
  const from = ar.from, to = ar.to;
  const c = v3.lerp(from, to, 0.5);
  const u = v3.sub(from, c);
  const r = Math.hypot(u[0], u[1]);
  const ud = v3.norm([u[0], u[1], 0]);
  // Lean the arc sideways as well as up, so it reads as a curve from above as well as from the side.
  const across = [-ud[1], ud[0], 0];
  const bow = v3.norm(v3.add(v3.mul([0, 0, ar.over ? 1 : -1], 0.62), v3.mul(across, 0.78)));
  const total = Math.PI * Math.min(1, (ar.angle || 180) / 180);
  const pts = [];
  const N = 28;
  const k = 0.82; // start and end a little inside the moving part
  for (let i = 0; i <= N; i++) {
    const phi = 0.1 + (total - 0.2) * (i / N);
    const x = r * k * Math.cos(phi), y = r * k * Math.sin(phi) * 0.75;
    pts.push([c[0] + ud[0] * x + bow[0] * y, c[1] + ud[1] * x + bow[1] * y, c[2] + bow[2] * y]);
  }
  return pts;
}

// The arrow's shaft, a strip along the path, with its heads: first the halo under it all (under true), then
// the ink. across(q, t) is the way across the strip at point q, where the path heads along t: turned to face
// the eye for an arrow standing over the paper, or flat for one lying on the table. k scales it all down.
const SHAFT = 0.0055, PAD = 0.0055, OUTLINE = 0.0042;
function ribbon(pts, across, arrow, halo, ink, under, k = 1) {
  const out = [];
  const w = (under ? SHAFT + PAD : SHAFT) * k;
  const push = (q, color) => out.push(q[0], q[1], q[2], ...color, 0);
  // Each point's two sides, across the path there, so neighbouring pieces meet without gaps or overlaps.
  const n = pts.length - 1;
  const sides = pts.map((q, i) => {
    const s = v3.mul(across(q, v3.norm(v3.sub(pts[Math.min(i + 1, n)], pts[Math.max(i - 1, 0)]))), w);
    return [v3.add(q, s), v3.sub(q, s)];
  });
  for (let i = 0; i < n; i++) {
    // A tuck's arrow breaks where it goes in under the edge of the pocket.
    if (arrow.tuck && i / n > 0.64 && i / n < 0.76) continue;
    const [a1, a2] = sides[i], [b1, b2] = sides[i + 1];
    for (const q of [a1, b1, b2, a1, b2, a2]) push(q, under ? halo : ink);
  }
  const mid = v3.lerp(pts[0], pts[n], 0.5);
  const end = v3.norm(v3.sub(pts[n], pts[n - 2]));
  arrowHead(push, pts[n], end, across(pts[n], end), arrow.head || 'valley', mid, halo, ink, under, k);
  // A fold and unfold comes back: an unfolding head at the tail, pointing back where it started.
  if (arrow.back) {
    const tail = v3.norm(v3.sub(pts[0], pts[2]));
    arrowHead(push, pts[0], tail, across(pts[0], tail), 'unfold', mid, halo, ink, under, k);
  }
  return out;
}

// An arrowhead at point b of a path heading along t, with s the way across it. Drawn in its own plane: x along
// the path, y across it. 'valley' is a solid head; 'mountain' a hollow head on one side only, the outside of the
// curve, with the shaft running on to its point; 'unfold' a hollow head on both sides. Hollow means an ink
// outline filled with the halo's colour.
function arrowHead(push, b, t, s, kind, mid, halo, ink, under, k = 1) {
  let shape, inset;
  if (kind === 'mountain') {
    if (v3.dot(s, v3.sub(b, mid)) < 0) s = v3.mul(s, -1);
    const L = 0.05 * k, H = 0.028 * k, w = SHAFT * k;
    // The point, the barb, and the shaft's far side; its edge along the shaft is as thick as the shaft.
    shape = [[0.6 * L, -w], [-0.4 * L, H], [-0.4 * L, -w]];
    inset = [OUTLINE * k, OUTLINE * k, 2 * w];
  } else {
    const L = (kind === 'valley' ? 0.036 : 0.046) * k, H = (kind === 'valley' ? 0.021 : 0.025) * k;
    shape = [[0.6 * L, 0], [-0.4 * L, H], [-0.4 * L, -H]];
    inset = OUTLINE * k;
  }
  const at = ([x, y]) => v3.add(b, v3.add(v3.mul(t, x), v3.mul(s, y)));
  const fill = (poly, color) => {
    for (let i = 1; i < poly.length - 1; i++) for (const q of [poly[0], poly[i], poly[i + 1]]) push(at(q), color);
  };
  if (under) { fill(offsetPoly(shape, -PAD * k), halo); return; }
  fill(shape, ink);
  if (kind !== 'valley') fill(offsetPoly(shape, inset), [halo[0], halo[1], halo[2], 1]);
}

// A convex polygon (counterclockwise) with its edges moved in by d (a number, or one per edge); out if negative.
function offsetPoly(poly, d) {
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const e = [(q[0] - p[0]) / l, (q[1] - p[1]) / l], k = Array.isArray(d) ? d[i] : d;
    return { p: [p[0] - e[1] * k, p[1] + e[0] * k], e };
  });
  return lines.map((b, i) => {
    const a = lines[(i + n - 1) % n];
    const den = a.e[0] * b.e[1] - a.e[1] * b.e[0];
    const u = ((b.p[0] - a.p[0]) * b.e[1] - (b.p[1] - a.p[1]) * b.e[0]) / den;
    return [a.p[0] + a.e[0] * u, a.p[1] + a.e[1] * u];
  });
}
