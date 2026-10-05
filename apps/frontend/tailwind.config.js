
export default {
  content: ['./index.html','./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        un: {
          blue: '#009edb',
          dark: '#00205b',
          light: '#e6f5fb',
        },
        damage: {
          destroyed: '#ef4135',
          partial: '#f5a623',
          minimal: '#27ae60',
        }
      }
    }
  },
  plugins: [],
}
