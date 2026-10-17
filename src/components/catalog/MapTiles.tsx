import { useEffect, useRef, useState } from "react"
import Map, { Marker, NavigationControl } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import { setWorkerUrl } from "maplibre-gl"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import { PinGlyph, type Pin } from "./MapPins"

// Free, no-key light vector style (OpenFreeMap "positron"). If it fails or stalls we hand back to the plot view.
setWorkerUrl(workerUrl)
const STYLE = "https://tiles.openfreemap.org/styles/positron"

export default function MapTiles({ pins, selected, onSelect, onFail }: { pins: Pin[]; selected: string | null; onSelect: (id: string | null) => void; onFail: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const failed = useRef(false)
  const fail = () => { if (!failed.current) { failed.current = true; onFail() } }
  useEffect(() => {
    const t = setTimeout(() => { if (!loaded) fail() }, 8000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])
  const lats = pins.map((p) => p.lat), lons = pins.map((p) => p.lon)
  const bounds: [[number, number], [number, number]] = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
  return (
    <Map
      mapStyle={STYLE}
      initialViewState={{ bounds, fitBoundsOptions: { padding: 40, maxZoom: 14 } }}
      style={{ width: "100%", height: "100%" }}
      attributionControl={{ compact: true }}
      cooperativeGestures
      onLoad={() => setLoaded(true)}
      onError={() => fail()}
      onClick={() => onSelect(null)}
    >
      <NavigationControl showCompass={false} position="bottom-right" />
      {pins.map((p) => (
        <Marker key={p.id} longitude={p.lon} latitude={p.lat} anchor="center" onClick={(e) => { e.originalEvent.stopPropagation(); onSelect(p.id === selected ? null : p.id) }}>
          <button aria-label={`${p.label}, ${p.status.replace("_", " ")}`} className="grid size-6 place-items-center rounded-full outline-offset-1 focus-visible:outline-2 focus-visible:outline-foreground">
            <PinGlyph status={p.status} selected={p.id === selected} />
          </button>
        </Marker>
      ))}
    </Map>
  )
}
