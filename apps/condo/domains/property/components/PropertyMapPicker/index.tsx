import React, { useCallback, useEffect, useRef, useState } from 'react'

import { Search } from '@open-condo/icons'
import { useIntl } from '@open-condo/next/intl'
import { Button, Input, Space, Typography } from '@open-condo/ui'
import { colors } from '@open-condo/ui/colors'

import styles from './PropertyMapPicker.module.css'

import type { Map as LeafletMap, CircleMarker } from 'leaflet'


// Ulaanbaatar city centre
const DEFAULT_CENTER: [number, number] = [47.9185, 106.9176]
const DEFAULT_ZOOM = 13
const PICK_ZOOM = 17
const TILES_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILES_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'

export type PickedPlace = {
    address: string
    name: string | null
    lat: number
    lon: number
}

type NominatimPlace = {
    lat: string
    lon: string
    name?: string
    display_name?: string
    address?: Record<string, string>
}

/**
 * Builds a Mongolian-style address (from the largest area to the smallest):
 * "Улаанбаатар, Сүхбаатар дүүрэг, 1-р хороо, Энхтайваны өргөн чөлөө, 15"
 */
function formatAddress (place: NominatimPlace): string {
    const address = place.address || {}
    const parts = [
        address.city || address.town || address.village || address.state,
        address.city_district || address.district || address.county,
        address.suburb || address.quarter || address.neighbourhood,
        address.road,
        address.house_number,
    ]
    const uniqueParts = parts.filter((part, index) => part && parts.indexOf(part) === index)
    if (uniqueParts.length > 0) return uniqueParts.join(', ')

    return (place.display_name || '').split(', ').reverse().join(', ')
}

async function nominatim (path: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'mn', addressdetails: '1', ...params })
    const response = await fetch(`${NOMINATIM_URL}/${path}?${query}`)
    if (!response.ok) throw new Error(`Nominatim responded with ${response.status}`)
    return response.json()
}

type PropertyMapPickerProps = {
    onPick: (place: PickedPlace) => void
}

/**
 * OpenStreetMap map to pick a building by clicking on it.
 * The address is resolved with OSM Nominatim (public instance, max 1 request per second),
 * which is fine for occasional property creation by staff.
 */
export const PropertyMapPicker: React.FC<PropertyMapPickerProps> = ({ onPick }) => {
    const intl = useIntl()
    const SearchPlaceholder = intl.formatMessage({ id: 'pages.condo.property.form.map.SearchPlaceholder' })
    const HintMessage = intl.formatMessage({ id: 'pages.condo.property.form.map.Hint' })
    const NotFoundMessage = intl.formatMessage({ id: 'pages.condo.property.form.map.NotFound' })
    const LoadingMessage = intl.formatMessage({ id: 'pages.condo.property.form.map.Loading' })

    const containerRef = useRef<HTMLDivElement>(null)
    const mapRef = useRef<LeafletMap>(null)
    const markerRef = useRef<CircleMarker>(null)
    const onPickRef = useRef(onPick)
    onPickRef.current = onPick

    const [status, setStatus] = useState<string>(HintMessage)
    const [search, setSearch] = useState('')

    const pick = useCallback(async (lat: number, lon: number) => {
        const L = await import('leaflet')
        const map = mapRef.current
        if (!map) return

        if (markerRef.current) {
            markerRef.current.setLatLng([lat, lon])
        } else {
            markerRef.current = L.circleMarker([lat, lon], {
                radius: 10, color: colors.white, weight: 3, fillColor: colors.green[5], fillOpacity: 1,
            }).addTo(map)
        }

        setStatus(LoadingMessage)
        try {
            const place = await nominatim('reverse', { lat: String(lat), lon: String(lon), zoom: '18' }) as NominatimPlace
            const address = formatAddress(place)
            if (!address) {
                setStatus(NotFoundMessage)
                return
            }
            setStatus(address)
            onPickRef.current({ address, name: place.name || null, lat, lon })
        } catch (e) {
            console.warn('Failed to resolve address by coordinates', e)
            setStatus(NotFoundMessage)
        }
    }, [LoadingMessage, NotFoundMessage])

    useEffect(() => {
        let isCancelled = false

        import('leaflet').then((L) => {
            if (isCancelled || !containerRef.current || mapRef.current) return

            const map = L.map(containerRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM)
            L.tileLayer(TILES_URL, { maxZoom: 19, attribution: TILES_ATTRIBUTION }).addTo(map)
            map.on('click', (event) => pick(event.latlng.lat, event.latlng.lng))
            mapRef.current = map
        })

        return () => {
            isCancelled = true
            if (mapRef.current) {
                mapRef.current.remove()
                mapRef.current = null
                markerRef.current = null
            }
        }
    }, [pick])

    const handleSearch = useCallback(async () => {
        if (!search.trim() || !mapRef.current) return
        setStatus(LoadingMessage)
        try {
            const places = await nominatim('search', { q: search, countrycodes: 'mn', limit: '1' }) as NominatimPlace[]
            if (places.length === 0) {
                setStatus(NotFoundMessage)
                return
            }
            const lat = Number(places[0].lat)
            const lon = Number(places[0].lon)
            mapRef.current.setView([lat, lon], PICK_ZOOM)
            await pick(lat, lon)
        } catch (e) {
            console.warn('Failed to search address', e)
            setStatus(NotFoundMessage)
        }
    }, [search, pick, LoadingMessage, NotFoundMessage])

    return (
        <Space direction='vertical' size={12} width='100%'>
            <div className={styles.search}>
                <Input
                    placeholder={SearchPlaceholder}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        // Enter must not submit the property form
                        event.preventDefault()
                        handleSearch()
                    }}
                />
                <Button type='secondary' icon={<Search size='medium' />} onClick={handleSearch} />
            </div>
            <div ref={containerRef} className={styles.map} />
            <Typography.Text type='secondary' size='medium'>{status}</Typography.Text>
        </Space>
    )
}
