import { useState, useCallback } from 'react';

interface GeoState {
  lat?: number;
  lng?: number;
  loading: boolean;
  error?: string;
}

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ loading: false });

  const getLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState(s => ({ ...s, error: 'Geolocation is not supported by your browser' }));
      return;
    }
    setState({ loading: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => setState({ lat: pos.coords.latitude, lng: pos.coords.longitude, loading: false }),
      (err) => {
        let msg = 'Could not get your location';
        if (err.code === 1) msg = 'Location access denied. Please allow location or pin on map.';
        else if (err.code === 2) msg = 'Location unavailable. Please pin on map instead.';
        setState({ loading: false, error: msg });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  return { ...state, getLocation };
}
