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
  vec3 col = base * (0.42 + 0.18 * sky + 0.52 * diff) * (0.965 + 0.05 * grain);
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
  gl_FragColor = vec4(vColor.rgb, vColor.a * uAlpha);
}`;

const MAT_VS = `
attribute vec3 aPos; uniform mat4 uViewProj; varying vec2 vP;
void main() { vP = aPos.xy; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

const MAT_FS = `
precision mediump float;
uniform vec3 uMat; uniform vec3 uLine; uniform vec2 uCenter; uniform float uFade;
varying vec2 vP;
float gridLine(vec2 p, float step, float w) {
  vec2 g = abs(fract(p / step - 0.5) - 0.5) * step;
  return 1.0 - smoothstep(0.0, w, min(g.x, g.y));
}
void main() {
  float minor = gridLine(vP, 0.1, 0.0022) * 0.35;
  float major = gridLine(vP, 0.5, 0.004);
  vec3 col = mix(uMat, uLine, max(minor, major));
  float d = length(vP - uCenter);
  float a = 1.0 - smoothstep(uFade * 0.55, uFade, d);
  gl_FragColor = vec4(col, a);
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
    const gl = canvas.getContext('webgl', { antialias: true, stencil: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    this.paper = compile(gl, PAPER_VS, PAPER_FS);
    this.flat = compile(gl, FLAT_VS, FLAT_FS);
    this.mat = compile(gl, MAT_VS, MAT_FS);
    this.buf = {
      paper: gl.createBuffer(), edges: gl.createBuffer(), shadow: gl.createBuffer(),
      marks: gl.createBuffer(), mat: gl.createBuffer(),
    };
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
  frame(cx, cy, size) {
    this.goal.target = [cx, cy, 0];
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
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

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
    if (this.marks && this.markAlpha > 0.01) {
      gl.disable(gl.DEPTH_TEST);
      this.drawMarks(vp, eye);
    }
  }

  drawMat(vp) {
    const gl = this.gl, { p, loc } = this.mat;
    const [cx, cy] = this.cam.target;
    const S = 3.2;
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
  drawMarks(vp, eye) {
    for (const m of this.marks) this.drawMark(m, vp, eye);
  }

  drawMark(m, vp, eye) {
    const ink = [0.09, 0.11, 0.16, 1], halo = [1, 1, 1, 0.92];
    // The line: a flat strip lying on the paper.
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
    const dash = m.type === 'mountain' ? 2 : 1;
    this.drawFlat(this.buf.marks, lineData(0.0075, halo), vp, dash, this.markAlpha);
    this.drawFlat(this.buf.marks, lineData(0.0042, ink), vp, dash, this.markAlpha);
    // The arrow: an arc from the moving part over the fold, facing the camera.
    const arc = arrowPath(m.arrow);
    this.drawFlat(this.buf.marks, ribbon(arc, eye, 0.011, halo, true), vp, 0, this.markAlpha);
    this.drawFlat(this.buf.marks, ribbon(arc, eye, 0.0055, ink, true), vp, 0, this.markAlpha);
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

// A strip along a path, turned to face the eye, with an arrowhead at the end.
function ribbon(pts, eye, w, color, head) {
  const out = [];
  const push = (q) => out.push(q[0], q[1], q[2], ...color, 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const t = v3.norm(v3.sub(b, a));
    const toEye = v3.norm(v3.sub(eye, a));
    const s = v3.mul(v3.norm(v3.cross(t, toEye)), w);
    const a1 = v3.add(a, s), a2 = v3.sub(a, s), b1 = v3.add(b, s), b2 = v3.sub(b, s);
    [a1, b1, b2, a1, b2, a2].forEach(push);
  }
  if (head) {
    const b = pts[pts.length - 1], a = pts[pts.length - 3];
    const t = v3.norm(v3.sub(b, a));
    const toEye = v3.norm(v3.sub(eye, b));
    const s = v3.norm(v3.cross(t, toEye));
    const L = w * 6, H = w * 3.6;
    const tip = v3.add(b, v3.mul(t, L * 0.6));
    const back = v3.sub(b, v3.mul(t, L * 0.4));
    [tip, v3.add(back, v3.mul(s, H)), v3.sub(back, v3.mul(s, H))].forEach(push);
  }
  return out;
}
