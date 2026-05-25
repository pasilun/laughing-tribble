'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BuildingModelV2, Wall } from '@/types/building-v2'

interface IFCViewerProps {
  model: BuildingModelV2
}

function wallLength(w: Wall): number {
  const dx = w.end.x - w.start.x
  const dy = w.end.y - w.start.y
  return Math.sqrt(dx * dx + dy * dy)
}

function wallAngle(w: Wall): number {
  return Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x)
}

export default function IFCViewer({ model }: IFCViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1c1c2e)

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000)

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.shadowMap.enabled = true
    container.appendChild(renderer.domElement)

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambient)
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(10, 20, 10)
    sun.castShadow = true
    scene.add(sun)

    // Materials
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xd4c5a9 })
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x8b7355 })
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x8b4513, side: THREE.DoubleSide })
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x87ceeb, transparent: true, opacity: 0.5 })

    const group = new THREE.Group()

    // Floor slab
    const allX = model.walls.flatMap(w => [w.start.x, w.end.x])
    const allY = model.walls.flatMap(w => [w.start.y, w.end.y])
    const minX = Math.min(...allX), maxX = Math.max(...allX)
    const minY = Math.min(...allY), maxY = Math.max(...allY)
    const bldgW = maxX - minX, bldgD = maxY - minY
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2

    const slabGeo = new THREE.BoxGeometry(bldgW, model.slabThickness, bldgD)
    const slab = new THREE.Mesh(slabGeo, floorMat)
    slab.position.set(cx, -model.slabThickness / 2, cy)
    slab.receiveShadow = true
    group.add(slab)

    // Walls
    for (const wall of model.walls) {
      const len = wallLength(wall)
      const angle = wallAngle(wall)

      const geo = new THREE.BoxGeometry(len, wall.height, wall.thickness)
      const mesh = new THREE.Mesh(geo, wallMat)

      // Centre of wall segment
      const mx = (wall.start.x + wall.end.x) / 2
      const my = (wall.start.y + wall.end.y) / 2
      mesh.position.set(mx, wall.height / 2, my)
      mesh.rotation.y = -angle
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }

    // Windows (simple blue boxes)
    for (const opening of model.openings) {
      if (opening.type !== 'window') continue
      const wall = model.walls.find(w => w.id === opening.wallId)
      if (!wall) continue

      const angle = wallAngle(wall)
      const len = wallLength(wall)
      const t = (opening.offsetFromStart + opening.width / 2) / len
      const wx = wall.start.x + (wall.end.x - wall.start.x) * t
      const wy = wall.start.y + (wall.end.y - wall.start.y) * t
      const sillH = opening.sillHeight ?? 0.9

      const geo = new THREE.BoxGeometry(opening.width, opening.height, wall.thickness + 0.02)
      const mesh = new THREE.Mesh(geo, glassMat)
      mesh.position.set(wx, sillH + opening.height / 2, wy)
      mesh.rotation.y = -angle
      group.add(mesh)
    }

    // Roof
    const roofHeight = Math.tan((model.roof.pitch * Math.PI) / 180) * (bldgD / 2)
    const overhang = model.roof.overhang

    if (model.roof.type === 'sadel') {
      // Ridge runs along the length (X axis)
      const ridgeLen = bldgW + overhang * 2
      const slopeW = Math.sqrt((bldgD / 2 + overhang) ** 2 + roofHeight ** 2)
      const slopeAngle = Math.atan2(roofHeight, bldgD / 2 + overhang)
      const wallH = model.walls[0]?.height ?? 2.4

      for (const side of [-1, 1] as const) {
        const geo = new THREE.PlaneGeometry(ridgeLen, slopeW)
        const mesh = new THREE.Mesh(geo, roofMat)
        // Position: centre along X, offset in Z by half bldgD, at wall height
        mesh.position.set(
          cx,
          wallH + roofHeight / 2,
          cy + side * (bldgD / 4 + overhang / 2)
        )
        mesh.rotation.x = -side * slopeAngle
        mesh.castShadow = true
        group.add(mesh)
      }
    } else if (model.roof.type === 'pulpet') {
      const wallH = model.walls[0]?.height ?? 2.4
      const slopeW = Math.sqrt((bldgD + overhang * 2) ** 2 + roofHeight ** 2)
      const slopeAngle = Math.atan2(roofHeight, bldgD + overhang * 2)
      const ridgeLen = bldgW + overhang * 2

      const geo = new THREE.PlaneGeometry(ridgeLen, slopeW)
      const mesh = new THREE.Mesh(geo, roofMat)
      mesh.position.set(cx, wallH + roofHeight / 2, cy)
      mesh.rotation.x = -slopeAngle
      mesh.castShadow = true
      group.add(mesh)
    } else {
      // flat
      const wallH = model.walls[0]?.height ?? 2.4
      const geo = new THREE.BoxGeometry(bldgW + overhang * 2, 0.15, bldgD + overhang * 2)
      const mesh = new THREE.Mesh(geo, roofMat)
      mesh.position.set(cx, wallH + 0.075, cy)
      mesh.castShadow = true
      group.add(mesh)
    }

    // Grid helper
    const grid = new THREE.GridHelper(20, 20, 0x444466, 0x333355)
    scene.add(grid)

    scene.add(group)

    // Fit camera to building
    const bbox = new THREE.Box3().setFromObject(group)
    const bboxCenter = bbox.getCenter(new THREE.Vector3())
    const bboxSize = bbox.getSize(new THREE.Vector3())
    const maxDim = Math.max(bboxSize.x, bboxSize.y, bboxSize.z)
    camera.position.set(
      bboxCenter.x + maxDim * 2,
      bboxCenter.y + maxDim * 1.5,
      bboxCenter.z + maxDim * 2
    )
    camera.lookAt(bboxCenter)

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(bboxCenter)
    controls.update()

    // Animation loop
    let animId: number
    function animate() {
      animId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize handler
    function onResize() {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [model])

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ height: '500px' }}
    />
  )
}
