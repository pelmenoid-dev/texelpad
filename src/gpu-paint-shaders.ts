// All paint targets store unpremultiplied, encoded RGBA bytes. Quantization and
// color-space conversion belong to the display pass, never to brush blending.
export const MAX_DABS = 32;

export const fullscreenVertex = `
precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const coverageVertex = `
precision highp float;
in vec3 position;
in float faceId;
uniform vec2 mapSize;
flat out int face;
void main() {
  face = int(faceId);
  gl_Position = vec4(position.xy / mapSize * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const textureCoverageFragment = `
precision highp float;
uniform vec2 mapSize;
uniform vec4 rect;
uniform vec2 dabs[${MAX_DABS}];
uniform int dabCount;
uniform float radius;
uniform float opacity;
uniform float hardness;
uniform int tool;
out vec4 result;
void main() {
  vec2 screen=rect.xy+gl_FragCoord.xy/mapSize*rect.zw;
  float alpha=0.0;
  for (int i=0; i<${MAX_DABS}; i++) {
    if (i>=dabCount) break;
    vec2 delta=abs(screen-dabs[i])/radius;
    float d=tool==0 ? max(delta.x,delta.y) : length(delta);
    if (d<=1.0) alpha=max(alpha,opacity*(tool==1 ? min(1.0,(1.0-d)/max(.001,1.0-hardness)) : 1.0));
  }
  result=vec4(alpha);
}
`;

export const coverageFragment = `
precision highp float;
precision highp int;
uniform sampler2D faces;
uniform sampler2D nodes;
uniform sampler2D triangles;
uniform int nodeCount;
uniform mat4 viewProjection;
uniform vec2 viewport;
uniform vec2 dabs[${MAX_DABS}];
uniform int dabCount;
uniform float radius;
uniform float opacity;
uniform float hardness;
uniform int tool;
flat in int face;
out vec4 result;

vec4 entry(sampler2D table, int i) {
  int width = textureSize(table, 0).x;
  return texelFetch(table, ivec2(i % width, i / width), 0);
}
vec3 weights(vec2 p, vec2 a, vec2 b, vec2 c) {
  float den = (b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
  if (abs(den) < 1e-12) return vec3(-1.0);
  float s = ((b.y-c.y)*(p.x-c.x)+(c.x-b.x)*(p.y-c.y))/den;
  float v = ((c.y-a.y)*(p.x-c.x)+(a.x-c.x)*(p.y-c.y))/den;
  vec3 margin=.5/abs(den)*vec3(abs(b.y-c.y)+abs(c.x-b.x), abs(c.y-a.y)+abs(a.x-c.x), abs(a.y-b.y)+abs(b.x-a.x));
  if (s>=margin.x && v>=margin.y && 1.0-s-v>=margin.z) return vec3(s,v,1.0-s-v);
  vec2 polygon[8], clipped[8];
  polygon[0]=a-p; polygon[1]=b-p; polygon[2]=c-p;
  int count=3;
  for (int edge=0; edge<4; edge++) {
    int axis=edge/2, nextCount=0;
    float sign=edge%2==0 ? 1.0 : -1.0;
    for (int i=0; i<8; i++) {
      if (i>=count) break;
      vec2 q=polygon[i], r=polygon[(i+1)%count];
      float dq=q[axis]*sign+.5, dr=r[axis]*sign+.5;
      if (dq>=0.0) clipped[nextCount++]=q;
      if ((dq>=0.0)!=(dr>=0.0)) clipped[nextCount++]=mix(q,r,dq/(dq-dr));
    }
    count=nextCount;
    if (count<3) return vec3(-1.0);
    for (int i=0; i<8; i++) { if (i>=count) break; polygon[i]=clipped[i]; }
  }
  float area=0.0;
  for (int i=1; i<7; i++) {
    if (i+1>=count) break;
    vec2 q=polygon[i]-polygon[0], r=polygon[i+1]-polygon[0];
    area+=q.x*r.y-q.y*r.x;
  }
  if (abs(area)<1e-12) return vec3(-1.0);
  vec2 center=vec2(0.0);
  for (int i=0; i<8; i++) { if (i>=count) break; center+=polygon[i]; }
  center=center/float(count)+p;
  s=((b.y-c.y)*(center.x-c.x)+(c.x-b.x)*(center.y-c.y))/den;
  v=((c.y-a.y)*(center.x-c.x)+(a.x-c.x)*(center.y-c.y))/den;
  return vec3(s,v,1.0-s-v);
}
bool visible(vec3 point, int ownTriangle) {
  float distance = length(point);
  float tolerance = max(1e-6, distance*1e-6);
  vec3 direction = point/distance;
  // Avoid 0*infinity at axis-aligned slab boundaries.
  vec3 inv = vec3(direction.x == 0.0 ? 1e30 : 1.0/direction.x,
    direction.y == 0.0 ? 1e30 : 1.0/direction.y,
    direction.z == 0.0 ? 1e30 : 1.0/direction.z);
  bool hit = false;
  if (ownTriangle >= 0) {
    vec3 normal=entry(triangles,ownTriangle*3).xyz;
    float side=entry(triangles,ownTriangle*3+1).w;
    float facing=dot(direction,normal);
    hit=facing!=0.0 && (facing<0.0 || side==1.0);
  }
  int n = 0;
  while (n < nodeCount) {
    vec4 lo = entry(nodes,n*2), hi = entry(nodes,n*2+1);
    vec3 t0 = (lo.xyz-vec3(tolerance))*inv, t1 = (hi.xyz+vec3(tolerance))*inv;
    vec3 near = min(t0,t1), far = max(t0,t1);
    float start = max(max(near.x,near.y),near.z);
    float end = min(min(far.x,far.y),far.z);
    if (end < max(0.0,start) || start > distance+tolerance) { n=int(lo.w); continue; }
    int packed = int(hi.w);
    if (packed == 0) { n++; continue; }
    int first = (packed-1)/8, count = (packed-1)%8+1;
    for (int i=0; i<8; i++) {
      if (i>=count) break;
      // This point was constructed on its own triangle. Re-intersecting that
      // plane at a grazing angle amplifies float error into false paint holes.
      if (first+i==ownTriangle) continue;
      vec4 normal = entry(triangles,(first+i)*3);
      vec4 cross1 = entry(triangles,(first+i)*3+1);
      vec3 cross2 = entry(triangles,(first+i)*3+2).xyz;
      float determinant = dot(direction,normal.xyz);
      if (determinant == 0.0 || (determinant > 0.0 && cross1.w == 0.0)) continue;
      float sign = determinant > 0.0 ? 1.0 : -1.0;
      determinant *= sign;
      float b1 = sign*dot(direction,cross1.xyz), b2 = sign*dot(direction,cross2);
      // The source point is nudged inside the face. Allow one float ULP at its
      // edges as GPU arithmetic has less precision than the CPU reference.
      float edgeTolerance = determinant*2e-6;
      if (b1 < -edgeTolerance || b2 < -edgeTolerance || b1+b2 > determinant+edgeTolerance) continue;
      float numerator = -sign*normal.w;
      if (numerator < 0.0) continue;
      float t = numerator/determinant;
      if (t < distance-tolerance) return false;
      if (t <= distance+tolerance) hit = true;
    }
    n=int(lo.w);
  }
  return hit;
}
void main() {
  vec4 a=entry(faces,face*5), b=entry(faces,face*5+1);
  vec4 c=entry(faces,face*5+2), uv=entry(faces,face*5+3);
  vec2 origin=entry(faces,face*5+4).xy;
  vec3 w=weights(gl_FragCoord.xy-origin,vec2(a.w,b.w),vec2(c.w,uv.x),uv.yz);
  if (w.x < 0.0) discard;
  w=(w+1e-7)/(1.0+3e-7);
  vec3 point=a.xyz+b.xyz*w.y+c.xyz*w.z;
  vec4 clip=viewProjection*vec4(point,1.0);
  vec3 ndc=clip.xyz/clip.w;
  if (ndc.z < -1.0 || ndc.z > 1.0) discard;
  vec2 screen=vec2(ndc.x*.5+.5,.5-ndc.y*.5)*viewport;
  float alpha=0.0;
  for (int i=0; i<${MAX_DABS}; i++) {
    if (i>=dabCount) break;
    vec2 delta=abs(screen-dabs[i])/radius;
    float d=tool==0 ? max(delta.x,delta.y) : length(delta);
    if (d<=1.0) alpha=max(alpha,opacity*(tool==1 ? min(1.0,(1.0-d)/max(.001,1.0-hardness)) : 1.0));
  }
  if (alpha<=0.0 || !visible(point,int(uv.w))) discard;
  result=vec4(alpha);
}
`;

export const compositeFragment = `
precision highp float;
precision highp int;
uniform sampler2D base;
uniform sampler2D previous;
uniform sampler2D previousCoverage;
uniform sampler2D coverage;
uniform vec3 color;
uniform bool eraseAlpha;
uniform bool initialize;
layout(location=0) out vec4 painted;
layout(location=1) out vec4 accumulated;
void main() {
  ivec2 p=ivec2(gl_FragCoord.xy);
  vec4 original=texelFetch(base,p,0);
  if (initialize) { painted=original; accumulated=vec4(0.0); return; }
  float alpha=texelFetch(coverage,p,0).r;
  float old=texelFetch(previousCoverage,p,0).r;
  accumulated=vec4(max(old,alpha));
  if (alpha<=old) { painted=texelFetch(previous,p,0); return; }
  if (eraseAlpha) {
    painted=vec4(texelFetch(previous,p,0).rgb,floor(original.a*255.0*(1.0-alpha)+.5)/255.0);
  } else {
    float a=alpha+original.a*(1.0-alpha);
    vec3 rgb=(color*alpha+original.rgb*original.a*(1.0-alpha))/max(a,1e-8);
    painted=floor(vec4(rgb,a)*255.0+.5)/255.0;
  }
}
`;

export const displayFragment = `
precision highp float;
precision highp int;
precision highp usampler2D;
uniform sampler2D painted;
uniform usampler2D sampling;
uniform sampler2D quantization;
uniform bool srgb;
out vec4 result;
void main() {
  ivec2 size=textureSize(sampling,0);
  ivec2 p=ivec2(int(gl_FragCoord.x),size.y-1-int(gl_FragCoord.y));
  uint index=texelFetch(sampling,p,0).r;
  uint width=uint(textureSize(painted,0).x);
  result=texelFetch(painted,ivec2(int(index%width),int(index/width)),0);
  int cell=(p.y & 7)*8+(p.x & 7);
  ivec3 rgb=ivec3(floor(result.rgb*255.0+.5));
  result.rgb=vec3(texelFetch(quantization,ivec2(rgb.r,cell),0).r,
    texelFetch(quantization,ivec2(rgb.g,cell),0).r,
    texelFetch(quantization,ivec2(rgb.b,cell),0).r);
  // An sRGB framebuffer encodes this back into the processed bytes. Three then
  // decodes on sampling, just as it does for the idle CanvasTexture.
  if (srgb) result.rgb=mix(result.rgb/12.92,pow((result.rgb+.055)/1.055,vec3(2.4)),step(vec3(.04045),result.rgb));
}
`;
