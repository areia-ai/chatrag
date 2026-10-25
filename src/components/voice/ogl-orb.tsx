'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Renderer, Program, Mesh, Triangle, Color } from 'ogl';

interface OglOrbProps {
  /** Audio amplitude value from 0 to 1 */
  amplitude?: number;
  /** Whether the orb is currently active (visible) */
  isActive?: boolean;
  /** Opacity of the orb (0 to 1) */
  opacity?: number;
  /** Size of the canvas in pixels */
  size?: number;
  /** Base color of the orb */
  color?: [number, number, number];
  /** Speed multiplier for animation */
  speed?: number;
}

// Vertex shader - simple pass-through
const vertexShader = `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0, 1);
  }
`;

// Fragment Shader - Glazed Orb with Brand Gradient
const fragmentShader = `
  precision highp float;
  
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uSpeed;
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform vec2 uResolution;
  
  varying vec2 vUv;
  
  #define PI 3.14159265359

  // Simplex 3D Noise 
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

  float snoise(vec3 v){ 
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

    // First corner
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;

    // Other corners
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );

    //  x0 = x0 - 0.0 + 0.0 * C 
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

    // Permutations
    i = mod(i, 289.0 ); 
    vec4 p = permute( permute( permute( 
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

    // Gradients
    // ( N*N points uniformly over a square, mapped onto an octahedron.)
    float n_ = 1.0/7.0; // N=7
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z *ns.z);  //  mod(p,N*N)

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);

    //Normalise gradients
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    // Mix final noise value
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                  dot(p2,x2), dot(p3,x3) ) );
  }

  void main() {
    // Center UVs
    vec2 uv = vUv - 0.5;
    float r = length(uv);
    
    // Soft outer glow edge
    float alpha = 1.0 - smoothstep(0.45, 0.5, r);
    
    // Simulate 3D Sphere Normal
    vec3 normal = vec3(uv * 2.0, 0.0);
    float zSq = 1.0 - dot(normal.xy, normal.xy);
    normal.z = sqrt(max(0.0, zSq));
    
    // -------------------------------------------------------------------
    // Brand Gradient Implementation
    // Colors: #4080FF (Blue), #FFB001 (Yellow/Amber), #F44335 (Red)
    // -------------------------------------------------------------------
    
    vec3 colBlue = vec3(0.25, 0.5, 1.0);  // #4080FF
    vec3 colYellow = vec3(1.0, 0.69, 0.0); // #FFB001
    vec3 colRed = vec3(0.96, 0.26, 0.21);  // #F44335
    
    float angle = -0.785398; // -45 degrees
    float s = sin(angle);
    float c = cos(angle);
    mat2 rot = mat2(c, -s, s, c);
    vec2 rotUv = rot * (vUv - 0.5) + 0.5;
    float g = rotUv.x;
    
    // Base Gradient
    vec3 gradientColor;
    if (g < 0.5) {
        float t = smoothstep(0.0, 0.5, g);
        gradientColor = mix(colBlue, colYellow, t);
    } else {
        float t = smoothstep(0.5, 1.0, g);
        gradientColor = mix(colYellow, colRed, t);
    }
    
    // -------------------------------------------------------------------
    // Dynamic Waves & Noise
    // -------------------------------------------------------------------
    
    float t = uTime * uSpeed * 0.8;
    
    // High frequency "small" waves for elegant detail
    float waveDistortion = sin(uv.y * 20.0 + t * 2.0) * 0.03 * uAmplitude;
    
    // Noise layers for texture depth (The "Glazed" look)
    float n1 = snoise(vec3(normal * 2.5 + vec3(t, t*0.5, 0.0) + waveDistortion));
    float n2 = snoise(vec3(normal * 5.0 - vec3(0.0, t, t*0.2)));
    
    // Restore 3D Depth: Mix noise into the gradient even when idle
    // This creates the "marble" or "planet" surface depth
    vec3 surfaceColor = mix(gradientColor, gradientColor * 1.2, n2 * 0.3);
    surfaceColor = mix(surfaceColor, vec3(1.0), n1 * 0.1); // specular glimmer
    
    // Start with this textured surface
    vec3 finalColor = surfaceColor;
    
    // Non-linear amplitude response for smoother/subtler transition
    // pow(uAmplitude, 1.5) means low values stay lower, preventing jumpiness
    float smoothAmp = pow(uAmplitude, 1.5);
    
    // Fresnel Rim Lighting
    float viewAngle = 1.0 - normal.z; 
    float fresnel = pow(viewAngle, 2.5);
    
    // Ripple - sharper and faster
    float ripple = sin(r * 30.0 - uTime * 8.0); 
    // Uses smoothAmp for subtler onset
    float rippleMask = smoothstep(0.0, 0.5, ripple) * smoothAmp * smoothstep(0.0, 0.8, r);
    
    // Add Edge Glow & Ripple
    vec3 glowColor = vec3(0.6, 0.9, 1.0); 
    
    // Active Edge - Extra bright rim when loud
    float activeEdge = pow(viewAngle, 4.0) * smoothAmp * 2.0;
    
    finalColor += glowColor * (fresnel * 0.6 + rippleMask * 0.3 + activeEdge);

    // 3D Volume Shadow / Vignette
    // Darken the edges based on Z-depth to create strong spherical volume
    float depth = smoothstep(-0.2, 0.8, normal.z);
    finalColor *= 0.6 + 0.4 * depth;
    
    // Specular Highlight (The glossy reflection)
    // Always visible to establish surface
    vec3 lightDir = normalize(vec3(-1.0, 1.0, 1.0));
    float specular = pow(max(0.0, dot(normal, lightDir)), 32.0);
    finalColor += vec3(1.0) * specular * 0.4;
    
    // Audio Brightness Boost
    finalColor *= 1.0 + uAmplitude * 0.2; 
    
    // Final Alpha
    float finalAlpha = uOpacity;
    finalAlpha *= alpha;
    
    gl_FragColor = vec4(finalColor, clamp(finalAlpha, 0.0, 1.0));
  }
`;

export default function OglOrb({
  amplitude = 0,
  isActive = true,
  opacity = 0.8, // Increased for glassy look
  size = 500,
  color = [0.1, 0.4, 0.9], // Deep vivid blue base
  speed = 1.0,
}: OglOrbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const programRef = useRef<Program | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const amplitudeRef = useRef(amplitude);

  // Update amplitude ref for animation loop
  useEffect(() => {
    amplitudeRef.current = amplitude;
  }, [amplitude]);

  // Initialize WebGL
  useEffect(() => {
    if (!containerRef.current || !isActive) return;

    // Create renderer
    const renderer = new Renderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    // Set size
    renderer.setSize(size, size);

    // Create geometry (full-screen triangle)
    const geometry = new Triangle(gl);

    // Create program with shaders
    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: 0 },
        uSpeed: { value: speed },
        uOpacity: { value: opacity },
        uColor: { value: new Color(...color) },
        uResolution: { value: [size, size] },
      },
    });

    // Create mesh
    const mesh = new Mesh(gl, { geometry, program });

    // Store refs
    rendererRef.current = renderer;
    programRef.current = program;

    // Clear any existing children to prevent duplicates
    if (containerRef.current) {
      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }
    }

    // Append canvas
    containerRef.current.appendChild(gl.canvas);

    // Animation loop
    let startTime = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;

      if (programRef.current) {
        programRef.current.uniforms.uTime.value = elapsed;
        programRef.current.uniforms.uAmplitude.value = amplitudeRef.current;
        programRef.current.uniforms.uOpacity.value = opacity;
      }

      renderer.render({ scene: mesh });
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (containerRef.current && gl.canvas) {
        containerRef.current.removeChild(gl.canvas);
      }
      // Note: OGL doesn't have a dispose method, rely on garbage collection
      rendererRef.current = null;
      programRef.current = null;
    };
  }, [isActive, size, opacity, speed, color]);

  // Update uniforms when props change
  useEffect(() => {
    if (programRef.current) {
      programRef.current.uniforms.uSpeed.value = speed;
      programRef.current.uniforms.uColor.value = new Color(...color);
    }
  }, [speed, color]);

  if (!isActive) return null;

  return (
    <div
      ref={containerRef}
      className="ogl-orb-container"
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        // Use cubic root for highly sensitive "pop" active feel
        transform: `translate(-50%, -50%) scale(${1 + Math.pow(amplitude, 0.3) * 0.15})`,
        width: size,
        height: size,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
