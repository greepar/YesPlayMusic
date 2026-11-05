// The RNP rotation/displacement/blur pipeline, rendered into one bounded GPU
// surface. The final 64px blur makes a quarter-size intermediate sufficient;
// motion still runs at the display refresh rate and all effect strengths stay
// in CSS pixels. No experimental Chromium flags are required.
const vertex = `#version 300 es
out vec2 uv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0,1); }`;
const scene = `#version 300 es
precision highp float;
in vec2 uv;out vec4 color;
uniform sampler2D cover0,cover1,cover2,cover3,noiseMap;
uniform vec2 size;uniform float time;
vec2 rotatePoint(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
vec4 over(vec4 a,vec4 b){return vec4(a.rgb*a.a+b.rgb*(1.-a.a),a.a+b.a*(1.-a.a));}
vec4 crop(sampler2D image,vec2 p,vec2 center,float angle,float side){vec2 q=rotatePoint(p-center,-angle)/side+.5;if(any(lessThan(q,vec2(0)))||any(greaterThan(q,vec2(1))))return vec4(0);return texture(image,q);}
void main(){
 float m=max(size.x,size.y),side=.707*m;
 vec2 p=rotatePoint((vec2(uv.x,1.-uv.y)*size-size*.5)/1.2,time*6.2831853/150.)+m*.5;
 float n=texture(noiseMap,(p+.2*m)/(1.4*m)).a;
 p+=vec2((n-.5)*400.);
 vec2 c=vec2(m*.5);float d=.35*side;
 vec4 v=vec4(0);
 v=over(crop(cover0,p,c+vec2(-d,-d),time*6.2831853/60.,side),v);
 v=over(crop(cover1,p,c+vec2(d,-d),(time+5.)*6.2831853/60.,side),v);
 v=over(crop(cover2,p,c+vec2(-d,d),(time+10.)*6.2831853/60.,side),v);
 v=over(crop(cover3,p,c+vec2(d,d),(time+15.)*6.2831853/60.,side),v);
 float l=dot(v.rgb,vec3(.2126,.7152,.0722));
 v.rgb=clamp(mix(vec3(l),v.rgb,1.5),vec3(0),vec3(v.a))*.8;
 color=vec4(v.rgb+vec3(.14118,.13725,.16471)*(1.-v.a),1);
}`;
// Dense Gaussian samples are paired using bilinear filtering. Sparse samples
// several texels apart create periodic stripes around displaced cover edges.
const blur = `#version 300 es
precision highp float;in vec2 uv;out vec4 color;
uniform sampler2D source;uniform vec2 direction;uniform float sigma;
void main(){
 vec4 sum=texture(source,uv);float total=1.;
 for(int i=1;i<=49;i+=2){
  float a=float(i),b=a+1.;if(a>3.*sigma)break;
  float wa=exp(-.5*a*a/(sigma*sigma)),wb=exp(-.5*b*b/(sigma*sigma));
  float weight=wa+wb,offset=(a*wa+b*wb)/weight;
  sum+=(texture(source,uv+direction*offset)+texture(source,uv-direction*offset))*weight;
  total+=2.*weight;
 }
 color=sum/total;
}`;
// Quantize only once, at physical screen resolution, after dimming. A stable
// sub-LSB dither breaks up gradient bands without adding temporal flicker.
const present = `#version 300 es
precision highp float;precision highp int;
in vec2 uv;out vec4 color;uniform sampler2D source;
void main(){
 uvec2 p=uvec2(gl_FragCoord.xy);uint h=p.x*1664525u+p.y*1013904223u;
 h^=h>>16;h*=2246822519u;h^=h>>13;
 float d=(float(h&65535u)/65535.-.5)/255.;
 color=vec4(clamp(texture(source,uv).rgb*.7+d,0.,1.),1.);
}`;

export function createFluidGpuRenderer(
  canvas,
  covers,
  { seed, onFailure, onReady }
) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) return null;
  // Repeated 8-bit quantization produces visible contour bands in dark covers.
  // Keep the original SVG path on devices without float render targets.
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  const resources = [],
    images = new Set();
  let frame = null,
    disposed = false,
    running = false,
    dirty = true;
  let elapsed = 0,
    last = null,
    width = 0,
    height = 0,
    ready = false,
    generation = 0;
  let announced = false;
  let renderWidth = 0,
    renderHeight = 0,
    pixelRatio = 0;
  function shader(type, source) {
    const s = gl.createShader(type);
    resources.push(['Shader', s]);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(source) {
    const p = gl.createProgram();
    resources.push(['Program', p]);
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, source));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw Error(gl.getProgramInfoLog(p));
    return p;
  }
  function texture() {
    const t = gl.createTexture();
    resources.push(['Texture', t]);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  let sceneProgram, blurProgram, presentProgram;
  try {
    sceneProgram = program(scene);
    blurProgram = program(blur);
    presentProgram = program(present);
  } catch (_) {
    resources.forEach(([type, resource]) => gl[`delete${type}`](resource));
    return null;
  }
  const textures = covers.map(texture),
    noise = texture(),
    buffers = [texture(), texture()];
  const fb = gl.createFramebuffer();
  resources.push(['Framebuffer', fb]);
  const uniformCache = new Map();
  const uniform = (p, n) => {
    if (!uniformCache.has(p)) uniformCache.set(p, new Map());
    const locations = uniformCache.get(p);
    if (!locations.has(n)) locations.set(n, gl.getUniformLocation(p, n));
    return locations.get(n);
  };
  function stopFrame() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    last = null;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopFrame();
    generation++;
    observer.disconnect();
    globalThis.removeEventListener?.('resize', resize);
    canvas.removeEventListener('webglcontextlost', lost);
    images.forEach(i => {
      i.onload = null;
      i.onerror = null;
    });
    images.clear();
    resources.forEach(([type, r]) => gl[`delete${type}`](r));
  }
  function fail() {
    dispose();
    onFailure();
  }
  function lost(e) {
    e.preventDefault();
    fail();
  }
  function schedule() {
    if (!disposed && ready && frame === null)
      frame = requestAnimationFrame(draw);
  }
  function resize() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    const dpr = globalThis.devicePixelRatio || 1;
    if (!w || !h || (w === width && h === height && dpr === pixelRatio)) return;
    width = w;
    height = h;
    renderWidth = Math.ceil(w / 4);
    renderHeight = Math.ceil(h / 4);
    pixelRatio = dpr;
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    buffers.forEach(t => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA16F,
        renderWidth,
        renderHeight,
        0,
        gl.RGBA,
        gl.HALF_FLOAT,
        null
      );
    });
    ready = false;
    const request = ++generation,
      m = Math.max(w, h),
      extent = 1.4 * m;
    const image = new Image();
    images.add(image);
    image.onload = () => {
      images.delete(image);
      if (disposed || request !== generation) return;
      gl.bindTexture(gl.TEXTURE_2D, noise);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image
      );
      ready = true;
      dirty = true;
      schedule();
    };
    image.onerror = () => {
      images.delete(image);
      fail();
    };
    // Bake the exact SVG turbulence once per resize, rather than per frame.
    image.src =
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(extent / 4)}" height="${Math.ceil(extent / 4)}" viewBox="${-0.2 * m} ${-0.2 * m} ${extent} ${extent}"><filter id="n" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="${-0.2 * m}" y="${-0.2 * m}" width="${extent}" height="${extent}" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.005" numOctaves="1" seed="${seed}"/></filter><rect x="${-0.2 * m}" y="${-0.2 * m}" width="${extent}" height="${extent}" filter="url(#n)"/></svg>`
      );
  }
  function draw(now) {
    frame = null;
    if (disposed || !ready) return;
    if (running) {
      if (last !== null) elapsed += (now - last) / 1000;
      last = now;
    }
    try {
      if (dirty) {
        textures.forEach((t, i) => {
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            covers[i]
          );
        });
        dirty = false;
      }
      gl.viewport(0, 0, renderWidth, renderHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        buffers[0],
        0
      );
      gl.useProgram(sceneProgram);
      textures.forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(uniform(sceneProgram, `cover${i}`), i);
      });
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, noise);
      gl.uniform1i(uniform(sceneProgram, 'noiseMap'), 4);
      gl.uniform2f(uniform(sceneProgram, 'size'), width, height);
      gl.uniform1f(uniform(sceneProgram, 'time'), elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(blurProgram);
      gl.uniform1i(uniform(blurProgram, 'source'), 0);
      for (let pass = 0; pass < 2; pass++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          buffers[1 - pass],
          0
        );
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, buffers[pass]);
        gl.uniform2f(
          uniform(blurProgram, 'direction'),
          pass === 0 ? 1 / renderWidth : 0,
          pass === 1 ? 1 / renderHeight : 0
        );
        gl.uniform1f(
          uniform(blurProgram, 'sigma'),
          pass === 0 ? (64 * renderWidth) / width : (64 * renderHeight) / height
        );
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(presentProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, buffers[0]);
      gl.uniform1i(uniform(presentProgram, 'source'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } catch (_) {
      fail();
      return;
    }
    if (!announced) {
      if (gl.getError() !== gl.NO_ERROR) {
        fail();
        return;
      }
      announced = true;
      onReady();
    }
    if (running) schedule();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  globalThis.addEventListener?.('resize', resize);
  canvas.addEventListener('webglcontextlost', lost);
  resize();
  return {
    setRunning(value) {
      running = value;
      if (!value) stopFrame();
      schedule();
    },
    invalidate() {
      dirty = true;
      schedule();
    },
    dispose,
  };
}
