import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface GeoConnection {
  ip: string
  country: string
  city: string
  lat: number
  lon: number
  count: number
  processes: string[]
}

interface WorldMapProps {
  connections: GeoConnection[]
  height?: number
}

function MapController() {
  const map = useMap()

  useEffect(() => {
    // Disable scroll zoom for embedded map
    map.scrollWheelZoom.disable()
  }, [map])

  return null
}

export default function WorldMap({ connections, height = 300 }: WorldMapProps) {
  const mapRef = useRef(null)

  // Default center (roughly center of world map)
  const center: [number, number] = [30, 0]
  const zoom = 1.5

  // Calculate marker size based on connection count
  const getMarkerRadius = (count: number) => {
    return Math.min(Math.max(count * 3, 5), 20)
  }

  return (
    <div style={{ height }} className="rounded-lg overflow-hidden relative">
      {connections.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-dark-900/80">
          <p className="text-dark-500 text-sm">No external connections</p>
        </div>
      )}
      <MapContainer
        ref={mapRef}
        center={center}
        zoom={zoom}
        className="h-full w-full bg-dark-900"
        zoomControl={false}
        attributionControl={false}
        minZoom={1}
        maxZoom={8}
      >
        <MapController />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          className="map-tiles"
        />

        {/* Connection markers */}
        {connections.map((conn, index) => (
          <CircleMarker
            key={`${conn.lat}-${conn.lon}-${index}`}
            center={[conn.lat, conn.lon]}
            radius={getMarkerRadius(conn.count)}
            pathOptions={{
              color: '#0ea5e9',
              fillColor: '#0ea5e9',
              fillOpacity: 0.6,
              weight: 2
            }}
          >
            <Popup className="custom-popup">
              <div className="bg-dark-800 text-dark-100 p-2 rounded -m-3">
                <p className="font-medium">
                  {conn.city ? `${conn.city}, ${conn.country}` : conn.country}
                </p>
                <p className="text-xs text-dark-400 mt-1">
                  {conn.ip}
                </p>
                <p className="text-xs text-dark-400">
                  {conn.count} connection{conn.count > 1 ? 's' : ''}
                </p>
                {conn.processes.length > 0 && (
                  <p className="text-xs text-primary-400 mt-1">
                    {conn.processes.slice(0, 3).join(', ')}
                    {conn.processes.length > 3 && ` +${conn.processes.length - 3} more`}
                  </p>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-2 right-2 bg-dark-800/90 px-2 py-1 rounded text-xs text-dark-400 z-[1000]">
        {connections.length} location{connections.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
