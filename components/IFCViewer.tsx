'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as WebIFC from 'web-ifc'

interface IFCViewerProps {
  ifcData: Uint8Array
}

export default function IFCViewer({ ifcData }: IFCViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || ifcData.length === 0) return
    const container = containerRef.current
    const setStatus = (text: string) => {
      if (statusRef.current) statusRef.current.textContent = text
    }

    setStatus('Laddar IFC-parser…')

    // Scene
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
    scene.add(new THREE.GridHelper(30, 30, 0x333355, 0x222244))

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

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

    // Parse IFC with web-ifc
    async function loadIFC() {
      const ifcApi = new WebIFC.IfcAPI()

      const origFetch = window.fetch
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
        if (url.includes('.wasm') || url.includes('web-ifc')) {
          console.log('[IFC] fetch attempt:', url)
          setStatus('Hämtar WASM: ' + url.split('/').pop())
        }
        try {
          const res = await origFetch(input, init)
          if (url.includes('.wasm') || url.includes('web-ifc')) {
            console.log('[IFC] fetch response:', url, res.status, res.headers.get('content-type'))
          }
          return res
        } catch (e) {
          if (url.includes('.wasm') || url.includes('web-ifc')) {
            console.error('[IFC] fetch FAILED:', url, e)
          }
          throw e
        }
      }

      const wasmPath = window.location.origin + '/'
      console.log('[IFC] SetWasmPath:', wasmPath)
      ifcApi.SetWasmPath(wasmPath, true)
      try {
        await ifcApi.Init()
        console.log('[IFC] Init() succeeded')
      } catch (initErr) {
        console.error('[IFC] Init() failed:', initErr)
        // restore fetch before re-throwing
        window.fetch = origFetch
        throw initErr
      }
      window.fetch = origFetch

      setStatus('Analyserar IFC…')
      const modelID = ifcApi.OpenModel(ifcData, { COORDINATE_TO_ORIGIN: true })
      const geometries = ifcApi.LoadAllGeometry(modelID)

      const meshGroup = new THREE.Group()
      const matCache = new Map<string, THREE.MeshLambertMaterial>()

      function getMat(r: number, g: number, b: number, a: number) {
        const key = `${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)},${a.toFixed(2)}`
        if (!matCache.has(key)) {
          matCache.set(key, new THREE.MeshLambertMaterial({
            color: new THREE.Color(r, g, b),
            transparent: a < 1,
            opacity: a,
            side: THREE.DoubleSide,
          }))
        }
        return matCache.get(key)!
      }

      for (let i = 0; i < geometries.size(); i++) {
        const flatMesh = geometries.get(i)
        for (let j = 0; j < flatMesh.geometries.size(); j++) {
          const placedGeom = flatMesh.geometries.get(j)
          const geom = ifcApi.GetGeometry(modelID, placedGeom.geometryExpressID)

          const vPtr = geom.GetVertexData()
          const vSize = geom.GetVertexDataSize()
          const iPtr = geom.GetIndexData()
          const iSize = geom.GetIndexDataSize()

          const vData = ifcApi.GetVertexArray(vPtr, vSize)
          const iData = ifcApi.GetIndexArray(iPtr, iSize)

          const positions: number[] = []
          const normals: number[] = []
          for (let v = 0; v < vData.length; v += 6) {
            positions.push(vData[v], vData[v + 1], vData[v + 2])
            normals.push(vData[v + 3], vData[v + 4], vData[v + 5])
          }

          const bufGeo = new THREE.BufferGeometry()
          bufGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
          bufGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
          bufGeo.setIndex(new THREE.Uint32BufferAttribute(iData, 1))

          const c = placedGeom.color
          const mat = getMat(c.x, c.y, c.z, c.w)
          const mesh = new THREE.Mesh(bufGeo, mat)

          // flatTransformation is column-major; THREE.Matrix4.set() is row-major
          const m = placedGeom.flatTransformation
          mesh.matrix.set(
            m[0], m[4], m[8],  m[12],
            m[1], m[5], m[9],  m[13],
            m[2], m[6], m[10], m[14],
            m[3], m[7], m[11], m[15]
          )
          mesh.matrixAutoUpdate = false
          meshGroup.add(mesh)
          if (typeof geom.delete === 'function') geom.delete()
        }
      }

      ifcApi.CloseModel(modelID)
      scene.add(meshGroup)

      // Fit camera
      const bbox = new THREE.Box3().setFromObject(meshGroup)
      if (!bbox.isEmpty()) {
        const center = bbox.getCenter(new THREE.Vector3())
        const size = bbox.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        camera.position.set(
          center.x + maxDim * 2,
          center.y + maxDim * 1.5,
          center.z + maxDim * 2
        )
        camera.lookAt(center)
        controls.target.copy(center)
        controls.update()
      }

      setStatus('✓ Modell laddad')
      setTimeout(() => {
        if (statusRef.current) statusRef.current.style.display = 'none'
      }, 2000)
    }

    loadIFC().catch(err => {
      console.error('IFC load error:', err)
      const msg = err instanceof Error ? err.message + (err.stack ? '\n' + err.stack.split('\n').slice(0,3).join('\n') : '') : String(err)
      setStatus('✗ ' + msg.substring(0, 200))
    })

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [ifcData])

  return (
    <div className="relative w-full rounded-lg overflow-hidden" style={{ height: '500px' }}>
      <div ref={containerRef} className="w-full h-full" />
      <div
        ref={statusRef}
        className="absolute top-3 left-3 text-xs text-zinc-300 bg-black/50 px-2 py-1 rounded pointer-events-none"
      >
        Laddar…
      </div>
    </div>
  )
}
