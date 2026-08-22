'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type ViewerPose = 'se' | 'n' | 'top'

interface GLTFViewerProps {
  glbUrl: string
  deterministic?: boolean
  pose?: ViewerPose
  hideAboveZ?: number
  onReady?: () => void
  onError?: (err: Error) => void
}

export default function GLTFViewer({
  glbUrl,
  deterministic = false,
  pose = 'se',
  hideAboveZ,
  onReady,
  onError,
}: GLTFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const compassRef = useRef<HTMLDivElement>(null)
  const onReadyRef = useRef(onReady)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onReadyRef.current = onReady
    onErrorRef.current = onError
  })

  useEffect(() => {
    if (!containerRef.current || !glbUrl) return
    const container = containerRef.current
    const setStatus = (text: string) => {
      if (statusRef.current) statusRef.current.textContent = text
    }

    setStatus('Laddar 3D-modell…')

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1c1c2e)

    const w = container.clientWidth
    const h = container.clientHeight
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 1000)
    camera.position.set(10, 8, 10)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(w, h)
    renderer.shadowMap.enabled = true
    container.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.0)
    sun.position.set(10, 20, 10)
    scene.add(sun)

    const grid = new THREE.GridHelper(30, 30, 0x333355, 0x222244)
    scene.add(grid)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = !deterministic

    const updateCompass = () => {
      if (!compassRef.current) return
      const dx = camera.position.x - controls.target.x
      const dz = camera.position.z - controls.target.z
      // IfcConvert maps IFC Y (North) to glTF -Z, so North = -Z in THREE.js.
      // azimuth = 0 when camera is due south (dz > 0, dx = 0) → N at top.
      const azimuth = Math.atan2(dx, dz)
      const compassEl = compassRef.current.querySelector('svg')
      if (compassEl) {
        ;(compassEl as unknown as HTMLElement).style.transform = `rotate(${azimuth}rad)`
        ;(compassEl as unknown as HTMLElement).style.transformOrigin = 'center'
      }
    }
    controls.addEventListener('change', updateCompass)
    updateCompass()

    let animId: number
    function animate() {
      animId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    function onResize() {
      const nw = container.clientWidth
      const nh = container.clientHeight
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)

    const loader = new GLTFLoader()
    loader.load(
      glbUrl,
      (gltf) => {
        if (hideAboveZ !== undefined) {
          gltf.scene.traverse((obj) => {
            if (!(obj as THREE.Mesh).isMesh) return
            const bb = new THREE.Box3().setFromObject(obj)
            if (bb.min.y >= hideAboveZ - 1e-6) obj.visible = false
          })
        }
        scene.add(gltf.scene)
        const bbox = new THREE.Box3().setFromObject(gltf.scene)
        if (!bbox.isEmpty()) {
          grid.position.y = bbox.min.y
          const center = bbox.getCenter(new THREE.Vector3())
          const size = bbox.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z)
          // Start due south so the 3D compass initially matches the 2D plan (N at top).
          const posePos: Record<ViewerPose, [number, number, number]> = {
            se: [center.x, center.y + maxDim * 1.5, center.z + maxDim * 2],
            n: [center.x, center.y + maxDim * 1.2, center.z - maxDim * 2],
            top: [center.x, center.y + maxDim * 2.5, center.z + maxDim * 0.05],
          }
          camera.position.set(...posePos[pose])
          camera.lookAt(center)
          controls.target.copy(center)
          controls.update()
          updateCompass()
          renderer.render(scene, camera)
        }
        setStatus('✓ Modell laddad')
        onReadyRef.current?.()
        setTimeout(() => {
          if (statusRef.current) statusRef.current.style.display = 'none'
        }, 2000)
      },
      undefined,
      (err) => {
        setStatus('✗ ' + String(err).substring(0, 200))
        onErrorRef.current?.(new Error(String(err)))
      }
    )

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      controls.removeEventListener('change', updateCompass)
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [glbUrl, deterministic, pose, hideAboveZ])

  return (
    <div className="relative w-full rounded-lg overflow-hidden" style={{ height: '500px' }}>
      <div ref={containerRef} className="w-full h-full" />
      <div
        ref={statusRef}
        className="absolute top-3 left-3 text-xs text-zinc-300 bg-black/50 px-2 py-1 rounded pointer-events-none"
      >
        Laddar…
      </div>
      <div
        ref={compassRef}
        style={{
          position: 'absolute', top: 12, right: 12,
          width: 56, height: 56,
          pointerEvents: 'none',
        }}
      >
        <svg viewBox="0 0 56 56" style={{ width: '100%', height: '100%' }}>
          <circle cx="28" cy="28" r="26" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.2)" strokeWidth="1"/>
          <polygon points="28,6 24,24 28,20 32,24" fill="#e05555"/>
          <polygon points="28,50 24,32 28,36 32,32" fill="rgba(255,255,255,0.7)"/>
          <text x="28" y="5" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="sans-serif">N</text>
          <text x="28" y="55" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="7" fontFamily="sans-serif">S</text>
          <text x="54" y="31" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="7" fontFamily="sans-serif">E</text>
          <text x="2" y="31" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="7" fontFamily="sans-serif">W</text>
        </svg>
      </div>
    </div>
  )
}
