import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ConsentProvider } from './consent/ConsentContext'
import './i18n'
import './index.css'

const storedLang = localStorage.getItem('undp_language') || 'en';
const rtlLangs = ['ar'];
document.documentElement.dir = rtlLangs.includes(storedLang) ? 'rtl' : 'ltr';
document.documentElement.lang = storedLang;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-un-dark">
          <div className="text-white text-sm opacity-60">Loading...</div>
        </div>
      }>
        <ConsentProvider>
          <App />
        </ConsentProvider>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      
    });
  });
}
