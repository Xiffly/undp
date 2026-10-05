import React from 'react';
import { getTileStyles } from './mapTiles';
import type { TileProvider } from './mapTiles';

interface Props {
  value: TileProvider;
  onChange: (v: TileProvider) => void;
}

export default function MapTileSelector({ value, onChange }: Props) {
  return (
    <div className="flex gap-2 rounded-2xl bg-white/92 p-2 shadow-lg ring-1 ring-black/5 backdrop-blur-sm">
      {getTileStyles().map((tile) => (
        <button
          key={tile.key}
          type="button"
          aria-pressed={value === tile.key}
          aria-label={`Map style ${tile.label}`}
          onClick={() => onChange(tile.key)}
          className={`group flex w-[4.5rem] flex-col items-stretch gap-1 rounded-xl border p-1.5 text-left transition-all sm:w-[5rem] ${
            value === tile.key
              ? `border-un-blue bg-un-light shadow-sm ring-2 ${tile.accentClass}`
              : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <span className="relative block h-9 overflow-hidden rounded-lg border border-white/70 shadow-inner sm:h-10" aria-hidden="true">
            <img
              src={tile.previewSrc}
              alt={`${tile.label} style preview`}
              className={`h-full w-full object-cover transition-transform duration-200 ${
                value === tile.key ? 'scale-[1.03]' : 'group-hover:scale-[1.02]'
              }`}
            />
            <span
              className={`absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-white/25 ${
                value === tile.key ? 'opacity-100' : 'opacity-80'
              }`}
            />
          </span>
          <span className={`text-[11px] font-semibold leading-tight ${value === tile.key ? 'text-un-dark' : 'text-gray-600 group-hover:text-gray-800'}`}>
            {tile.label}
          </span>
        </button>
      ))}
    </div>
  );
}
