import { useCallback, useEffect, useRef, useState } from 'react';
import { Marker, useMap, useMapEvents } from 'react-leaflet';
import { Search, X } from 'lucide-react';

export type GeoHit = {
  display_name: string;
  lat: string;
  lon: string;
};

export type AddressAutocompleteProps = {
  value: string;
  lang: string;
  label: string;
  optionalLabel: string;
  placeholder: string;
  helpText: string;
  searchHint: string;
  onChange: (value: string) => void;
  onPreview?: (lat: number, lng: number) => void;
  onSelect: (lat: number, lng: number, label: string) => void;
};

export function LocationPicker({
  lat,
  lng,
  onChange,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });

  return lat ? <Marker position={[lat, lng]} /> : null;
}

export function MapFlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const prev = useRef('');

  useEffect(() => {
    if (!lat || !lng) return;
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (key === prev.current) return;
    prev.current = key;
    map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 1 });
  }, [lat, lng, map]);

  return null;
}

export function AddressAutocomplete({
  value,
  lang,
  label,
  optionalLabel,
  placeholder,
  helpText,
  searchHint,
  onChange,
  onPreview,
  onSelect,
}: AddressAutocompleteProps) {
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (query: string) => {
    if (query.trim().length < 3) {
      setHits([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/reports/geocode?q=${encodeURIComponent(query)}`,
        { headers: { 'Accept-Language': lang || 'en' } }
      );
      const payload = await response.json() as { hits?: GeoHit[] };
      const data = Array.isArray(payload.hits) ? payload.hits : [];
      const first = data[0];
      const previewLat = Number.parseFloat(first?.lat || '');
      const previewLng = Number.parseFloat(first?.lon || '');
      if (Number.isFinite(previewLat) && Number.isFinite(previewLng)) {
        onPreview?.(previewLat, previewLng);
      }
      setHits(data);
      setOpen(data.length > 0);
    } catch {
      setHits([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, [lang, onPreview]);

  const handleChange = (nextValue: string) => {
    onChange(nextValue);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(nextValue), 380);
  };

  const pick = (hit: GeoHit) => {
    const nextLabel = hit.display_name.split(',').slice(0, 3).join(',').trim();
    onChange(nextLabel);
    onSelect(Number.parseFloat(hit.lat), Number.parseFloat(hit.lon), nextLabel);
    setHits([]);
    setOpen(false);
  };

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={wrapRef} className="relative mt-3">
      <label className="mb-1 block text-sm font-semibold text-gray-700">
        {label} <span className="font-normal text-gray-400">{optionalLabel}</span>
      </label>
      <div className="flex items-center overflow-hidden rounded-xl border border-gray-300 bg-white transition-all focus-within:border-un-blue focus-within:ring-2 focus-within:ring-un-blue/30">
        <Search size={14} className="ml-3 flex-shrink-0 text-gray-400" />
        <input
          type="text"
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent px-2 py-2.5 text-sm focus:outline-none"
        />
        {loading && <div className="mr-3 h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-un-blue/30 border-t-un-blue" />}
        {value && !loading && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              setHits([]);
              setOpen(false);
            }}
            className="mr-2 text-gray-400 hover:text-gray-600"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && hits.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-[1000] mt-1 max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {hits.map((hit, index) => (
            <button
              key={`${hit.lat}-${hit.lon}-${index}`}
              type="button"
              onClick={() => pick(hit)}
              className="w-full border-b border-gray-50 px-3 py-2.5 text-left text-sm transition-colors last:border-0 hover:bg-un-light"
            >
              <div className="truncate font-medium text-gray-800">{hit.display_name.split(',')[0]}</div>
              <div className="truncate text-xs text-gray-400">{hit.display_name.split(',').slice(1, 3).join(',')}</div>
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-gray-400">{helpText}</p>
      <p className="mt-1 text-xs text-gray-400">{searchHint}</p>
    </div>
  );
}
