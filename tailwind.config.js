module.exports = {
  content: ['./index.html', './player.html', './js/index.js', './js/player.js', './js/common.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'sans-serif']
      },
      colors: {
        brand: {
          DEFAULT: '#ff2a74',
          hover: '#e11d62',
          glow: 'rgba(255, 42, 116, 0.4)'
        },
        dark: {
          bg: '#020205',
          surface: '#0d0d14',
          border: '#1f1f2e',
          muted: '#94a3b8'
        }
      }
    }
  }
};
