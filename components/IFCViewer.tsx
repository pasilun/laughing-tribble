'use client'

import { useEffect, useRef } from 'react'

interface IFCViewerProps {
  ifcData: Uint8Array
}

export default function IFCViewer({ ifcData }: IFCViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || ifcData.length === 0) return

    function sendData() {
      iframe!.contentWindow?.postMessage(
        { type: 'load-ifc', bytes: ifcData },
        '*'
      )
    }

    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'viewer-ready') {
        sendData()
      }
    }

    window.addEventListener('message', onMessage)

    // Also try sending on load in case ready fired before listener attached
    iframe.addEventListener('load', sendData)

    return () => {
      window.removeEventListener('message', onMessage)
      iframe.removeEventListener('load', sendData)
    }
  }, [ifcData])

  return (
    <iframe
      ref={iframeRef}
      src="/ifc-viewer.html"
      className="w-full rounded-lg border-0"
      style={{ height: '500px' }}
      title="IFC 3D Viewer"
    />
  )
}
