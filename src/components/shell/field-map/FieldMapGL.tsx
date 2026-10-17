import { useEffect, useMemo, useRef, useState } from "react"
import Map, { NavigationControl, type MapRef } from "react-map-gl/maplibre"
import type { GeoJSONSource } from "maplibre-gl"
import { setWorkerUrl } from "maplibre-gl"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import "maplibre-gl/dist/maplibre-gl.css"
import type { FieldWell } from "./data"
import { STATUS_COLOR } from "./data"

// MapLibre v6 derives its worker URL from import.meta.url, which breaks once Vite pre-bundles it. Point it at the real file.
setWorkerUrl(workerUrl)

// Free, no-key light vector style. If it fails or stalls, the panel falls back to the SVG plot.
const STYLE = "https://tiles.openfreemap.org/styles/positron"

type Props = {
  wells: FieldWell[]
  flagged: Set<string>
  selected: string | null
  onSelect: (id: string | null) => void
  onFail: () => void
  tilt: boolean
  focus: { lon: number; lat: number; zoom: number } | null
}

const square = (lon: number, lat: number, m: number) => {
  const dLat = m / 111_320
  const dLon = m / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [[[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]]]
}

export default function FieldMapGL({ wells, flagged, selected, onSelect, onFail, tilt, focus }: Props) {
  const ref = useRef<MapRef>(null)
  const [loaded, setLoaded] = useState(false)
  const failed = useRef(false)
  const fail = () => {
    if (!failed.current) {
      failed.current = true
      onFail()
    }
  }
  useEffect(() => {
    const t = setTimeout(() => !loaded && fail(), 9000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  const points = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: wells.map((w) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [w.lon, w.lat] },
        properties: { id: w.id, status: w.status, flagged: flagged.has(w.id) ? 1 : 0, selected: w.id === selected ? 1 : 0 },
      })),
    }),
    [wells, flagged, selected],
  )
  const columns = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: wells.map((w) => ({
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: square(w.lon, w.lat, 70) },
        properties: { id: w.id, h: 30 + w.downtime12m * 1.6, status: w.status },
      })),
    }),
    [wells],
  )

  useEffect(() => {
    ref.current?.easeTo({ pitch: tilt ? 55 : 0, bearing: tilt ? -18 : 0, duration: 700 })
  }, [tilt])
  useEffect(() => {
    if (focus) ref.current?.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom, duration: 800 })
  }, [focus])

  // Sources and layers are added imperatively: the TanStack devtools JSX plugin tags <Source>/<Layer>
  // with a data-tsd-source prop that MapLibre rejects.
  const color = ["match", ["get", "status"], "producing", STATUS_COLOR.producing, "not_producing", STATUS_COLOR.not_producing, STATUS_COLOR.unknown] as any
  useEffect(() => {
    const map = ref.current?.getMap()
    if (!loaded || !map) return
    const pts = map.getSource("wells-src") as GeoJSONSource | undefined
    if (pts) pts.setData(points as any)
    else {
      map.addSource("wells-src", { type: "geojson", data: points as any })
      map.addSource("cols", { type: "geojson", data: columns as any })
      map.addLayer({ id: "columns", type: "fill-extrusion", source: "cols", layout: { visibility: "none" }, paint: { "fill-extrusion-color": color, "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 0.82 } })
      map.addLayer({ id: "halo", type: "circle", source: "wells-src", filter: ["==", ["get", "flagged"], 1], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 7, 14, 13], "circle-color": "rgba(194,40,28,0.12)", "circle-stroke-color": "#c2281c", "circle-stroke-width": 1.25 } })
      map.addLayer({ id: "wells", type: "circle", source: "wells-src", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 7], "circle-color": color, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.25 } })
      map.addLayer({ id: "selected", type: "circle", source: "wells-src", filter: ["==", ["get", "selected"], 1], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 9, 14, 15], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#14213d", "circle-stroke-width": 2.5 } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, points])
  useEffect(() => {
    const map = ref.current?.getMap()
    if (loaded && map?.getLayer("columns")) map.setLayoutProperty("columns", "visibility", tilt ? "visible" : "none")
  }, [loaded, tilt])

  const lats = wells.map((p) => p.lat)
  const lons = wells.map((p) => p.lon)
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ]
  return (
    <Map
      ref={ref}
      mapStyle={STYLE}
      initialViewState={{ bounds, fitBoundsOptions: { padding: 36 } }}
      style={{ width: "100%", height: "100%" }}
      attributionControl={{ compact: true }}
      interactiveLayerIds={["wells"]}
      cursor="auto"
      onLoad={() => setLoaded(true)}
      onError={(e) => console.warn("[field-map]", e.error?.message)}
      onClick={(e) => onSelect((e.features?.[0]?.properties?.id as string | undefined) ?? null)}
      onMouseEnter={() => ref.current && (ref.current.getCanvas().style.cursor = "pointer")}
      onMouseLeave={() => ref.current && (ref.current.getCanvas().style.cursor = "")}
    >
      <NavigationControl showCompass={tilt} position="bottom-right" />
    </Map>
  )
}
