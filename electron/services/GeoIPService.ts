// GeoIP is now handled by the Go backend
// This service is kept for compatibility but delegates to the backend

export interface GeoLocation {
  country: string
  region: string
  city: string
  lat: number
  lon: number
  timezone: string
}

export class GeoIPService {
  // GeoIP lookup is now done by Go backend
  // Connection objects already contain Country, City, Lat, Lon fields
  lookup(_ip: string): GeoLocation | null {
    // Go backend handles GeoIP lookup automatically
    // Connection objects already contain geo data
    return null
  }

  async lookupAsync(_ip: string): Promise<GeoLocation | null> {
    // Go backend handles GeoIP lookup automatically
    // Connection objects already contain geo data
    return null
  }

  getCountryName(code: string): string {
    const countries: Record<string, string> = {
      US: 'United States',
      GB: 'United Kingdom',
      DE: 'Germany',
      FR: 'France',
      CA: 'Canada',
      AU: 'Australia',
      JP: 'Japan',
      CN: 'China',
      IN: 'India',
      BR: 'Brazil',
      RU: 'Russia',
      KR: 'South Korea',
      NL: 'Netherlands',
      SE: 'Sweden',
      SG: 'Singapore',
    }

    return countries[code] || code
  }

  clearCache(): void {
    // No-op - Go backend handles caching
  }
}
