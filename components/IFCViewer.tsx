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

    // iframe may already be loaded — send immediately and retry
    sendData()
    const t1 = setTimeout(sendData, 300)
    const t2 = setTimeout(sendData, 1000)

    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(t1)
      clearTimeout(t2)
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
