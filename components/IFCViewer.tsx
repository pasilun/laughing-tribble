'use client'

import { useEffect, useRef } from 'react'
import * as OBC from '@thatopen/components'
import * as THREE from 'three'

interface IFCViewerProps {
  ifcData: Uint8Array
}

export default function IFCViewer({ ifcData }: IFCViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || ifcData.length === 0) return
    const container = containerRef.current

    const components = new OBC.Components()

    const worlds = components.get(OBC.Worlds)
    const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>()
    world.scene = new OBC.SimpleScene(components)
    world.renderer = new OBC.SimpleRenderer(components, container)
    world.camera = new OBC.SimpleCamera(components)
    world.scene.setup()
    components.init()

    // Disable the "That Open Company" logo
    world.renderer.showLogo = false

    const fragments = components.get(OBC.FragmentsManager)
    fragments.init('/fragments-worker.mjs')

    const ifcLoader = components.get(OBC.IfcLoader)

    // Use local wasm files served from /public
    ifcLoader
      .setup({
        autoSetWasm: false,
        wasm: { path: '/', absolute: true },
      })
      .then(async () => {
        try {
          const model = await ifcLoader.load(ifcData, true, 'model')
          world.scene.three.add(model.object)

          // Fit camera to model
          const bbox = new THREE.Box3().setFromObject(model.object)
          const center = bbox.getCenter(new THREE.Vector3())
          const size = bbox.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z)
          const camera = world.camera.three as THREE.PerspectiveCamera
          camera.position.set(
            center.x + maxDim * 2,
            center.y + maxDim * 1.5,
            center.z + maxDim * 2
          )
          camera.lookAt(center)
        } catch (err) {
          console.error('IFC load error:', err)
        }
      })
      .catch((err: unknown) => console.error('IFC setup error:', err))

    return () => {
      try {
        components.dispose()
      } catch {
        // ignore disposal errors during unmount
      }
    }
  }, [ifcData])

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden bg-zinc-900"
      style={{ height: '500px' }}
    />
  )
}
