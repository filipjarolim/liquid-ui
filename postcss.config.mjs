/**
 * PostCSS — only globals.css should be the Tailwind entry.
 * Other CSS files are pulled in via @import from globals.css so
 * custom rules are not stripped by @tailwindcss/postcss.
 */
const config = {
	plugins: {
		'@tailwindcss/postcss': {},
	},
};

export default config;
