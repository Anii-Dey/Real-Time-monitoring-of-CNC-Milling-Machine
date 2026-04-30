module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}', './*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        glow: '0 35px 120px rgba(56, 189, 248, 0.12)',
      },
      backgroundImage: {
        'hero-gradient': 'radial-gradient(circle at top left, rgba(59,130,246,0.2), transparent 24%), radial-gradient(circle at bottom right, rgba(168,85,247,0.18), transparent 20%)',
      },
    },
  },
  plugins: [],
};
