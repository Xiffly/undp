import React from 'react';

export default function LoadingSpinner({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="w-10 h-10 border-4 border-un-blue/20 border-t-un-blue rounded-full animate-spin" />
      {text && <p className="text-gray-500 text-sm">{text}</p>}
    </div>
  );
}
