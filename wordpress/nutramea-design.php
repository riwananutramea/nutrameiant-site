<?php
/**
 * NutraMEA design tokens and brief subscriptions.
 *
 * GENERATED FILE. Built by tools/build.mjs from the repository stylesheets.
 * Edit site/assets/tokens.css, site/assets/site.css or
 * src/wordpress/nutramea-design.php.tpl and run `npm run build`.
 * Editing this file in WordPress will be overwritten on the next build.
 *
 * Install: see wordpress/README.md.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Loads the design tokens and site styles on every front end page.
 */
function nutramea_design_styles() {
	$css = <<<'NUTRAMEA_CSS'
/* Single source of truth for NutraMEA visual tokens. See DESIGN_RULES.md section 0. */
:root {
  /* Ground and surfaces. One background step, no more. */
  --bg: #0a0c0b;
  --panel: #111512;

  /* Text. One cool-neutral grey family. */
  --text: #f3f5f3;
  --muted: #98a099;

  /* The one accent. Target under 10% of visible surface. */
  --accent: #b9ff39;
  --accent-hover: #a1e622;
  --accent-ink: #0a0c0b;

  /* Meaning only, never variety. */
  --error: #ffaaa8;

  /* The one border colour and the one radius. */
  --line: rgba(255, 255, 255, 0.1);
  --radius: 4px;

  /* Type. Tahoma is an Arabic script fallback, not a second design family. */
  --font-ui: 'Inter', system-ui, -apple-system, sans-serif;
  --font-ar: Tahoma, Arial, sans-serif;

  /* Scale: 12 / 14 / 16 / 20 / 24 / 32 / 48. No sizes between steps. */
  --text-xs: 12px;
  --text-sm: 14px;
  --text-base: 16px;
  --text-lg: 20px;
  --text-xl: 24px;
  --text-2xl: 32px;
  --text-3xl: 48px;

  /* Spacing, 4px base. Every margin, padding and gap is a multiple of 4. */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;

  /* Layout */
  --measure: 68ch;
  --measure-title: 26ch;
  --content-max: 1180px;

  /* Motion. Colour only on hover, nothing eases for half a second. */
  --ease: 140ms ease-out;
}

/* NutraMEA site styles. Tokens only, no one-off values. See DESIGN_RULES.md. */

*,
*::before,
*::after { box-sizing: border-box; }

body,
h1, h2, h3, p, ul, ol, li, figure, dl, dd { margin: 0; padding: 0; }

body {
  background-color: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--text-base);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

[dir="rtl"] body { font-family: var(--font-ar); }

a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); }

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius);
}

.wrap {
  width: 100%;
  max-width: var(--content-max);
  margin: 0 auto;
  padding: 0 var(--space-4);
}

.measure { max-width: var(--measure); }

/* Utilities */

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.skip-link {
  position: absolute;
  inset-inline-start: var(--space-4);
  top: var(--space-2);
  z-index: 2;
  transform: translateY(-200%);
}
.skip-link:focus-visible { transform: translateY(0); }

/* Header */

.site-header {
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.site-header .wrap {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 56px;
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
}

.logo { display: inline-flex; width: 116px; }
.logo svg { width: 100%; height: auto; direction: ltr; }
.logo-word { fill: var(--text); }
.logo-mark { fill: var(--accent); }
.logo-rule { stroke: var(--accent); }

.menu-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: var(--space-2);
  margin-inline-start: auto;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--text);
  cursor: pointer;
}
.menu-toggle:hover { border-color: var(--line); }
.menu-toggle svg { width: 24px; height: 24px; }
.menu-toggle svg[hidden] { display: none; }

.site-nav {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  margin-inline-start: auto;
}

.site-nav a {
  color: var(--muted);
  font-size: var(--text-sm);
  transition: color var(--ease);
}
.site-nav a:hover,
.site-nav a[aria-current="page"] { color: var(--text); }

.lang {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-inline-start: var(--space-6);
}

.lang a {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  color: var(--muted);
  font-size: var(--text-sm);
  transition: color var(--ease), background-color var(--ease);
}
.lang a:hover { color: var(--text); background-color: var(--line); }
.lang a[aria-current="true"] { color: var(--accent); }

/* Sections */

main > section { padding: var(--space-16) 0; }
main > section + section { border-top: 1px solid var(--line); }

h1 {
  max-width: var(--measure-title);
  font-size: var(--text-3xl);
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-weight: 600;
  text-wrap: balance;
}

h2 {
  font-size: var(--text-xl);
  line-height: 1.25;
  font-weight: 600;
  margin-bottom: var(--space-6);
}

h3 {
  font-size: var(--text-lg);
  line-height: 1.3;
  font-weight: 600;
}

.lead {
  margin-top: var(--space-6);
  font-size: var(--text-base);
  color: var(--muted);
}

.label {
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

/* Buttons */

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-8);
}

.btn {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background-color: var(--accent);
  color: var(--accent-ink);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--ease), border-color var(--ease);
}
.btn:hover {
  background-color: var(--accent-hover);
  border-color: var(--accent-hover);
  color: var(--accent-ink);
}

.btn-secondary {
  background-color: transparent;
  border-color: var(--line);
  color: var(--text);
}
.btn-secondary:hover {
  background-color: transparent;
  border-color: var(--text);
  color: var(--text);
}

/* Content blocks. Sized by content, not forced into equal cards. */

.blocks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-12);
  list-style: none;
}

.blocks p {
  margin-top: var(--space-2);
  color: var(--muted);
  font-size: var(--text-sm);
}

.coverage {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: var(--space-4) var(--space-8);
  font-size: var(--text-sm);
  max-width: 720px;
}
.coverage dt { color: var(--muted); }
.coverage dd { color: var(--text); }

/* Subscribe */

.subscribe { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-6); }

.subscribe input[type="email"] {
  min-height: 40px;
  width: 280px;
  padding: var(--space-2) var(--space-3);
  background-color: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
  font-size: var(--text-sm);
  transition: border-color var(--ease);
}
.subscribe input[type="email"]:hover { border-color: var(--muted); }
.subscribe input[aria-invalid="true"] { border-color: var(--error); }

.form-status {
  flex-basis: 100%;
  margin-top: var(--space-1);
  color: var(--muted);
  font-size: var(--text-sm);
}
.form-status[data-state="ok"] { color: var(--accent); }
.form-status[data-state="failed"] { color: var(--error); }
.form-status[hidden] { display: none; }

.btn:disabled { color: var(--accent-ink); opacity: 0.6; cursor: default; }
.btn:disabled:hover { background-color: var(--accent); border-color: var(--accent); }

.field-error {
  flex-basis: 100%;
  margin-top: var(--space-1);
  color: var(--error);
  font-size: var(--text-sm);
}
.field-error[hidden] { display: none; }

/* Footer */

.site-footer {
  border-top: 1px solid var(--line);
  padding: var(--space-8) 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.site-footer .wrap { display: flex; flex-wrap: wrap; gap: var(--space-4); justify-content: space-between; }

.footer-links { display: flex; gap: var(--space-6); }
.site-footer a { color: var(--muted); transition: color var(--ease); }
.site-footer a:hover { color: var(--text); }

/* Mobile */

@media (max-width: 620px) {
  .menu-toggle { display: inline-flex; }

  .site-nav {
    display: none;
    flex-basis: 100%;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    margin-inline-start: 0;
    padding-bottom: var(--space-4);
  }
  .site-nav[data-open="true"] { display: flex; }
  .site-nav a { font-size: var(--text-base); }

  .lang { margin-inline-start: 0; }

  .site-header .wrap { flex-wrap: wrap; }

  main > section { padding: var(--space-12) 0; }

  .coverage { grid-template-columns: 1fr; gap: var(--space-1) var(--space-4); }
  .coverage dt { margin-top: var(--space-4); }
  .coverage dt:first-of-type { margin-top: 0; }

  h1 { font-size: var(--text-2xl); }

  .subscribe input[type="email"] { width: 100%; }
  .btn { width: auto; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
NUTRAMEA_CSS;

	wp_register_style( 'nutramea-design', false, array(), '719311035603' );
	wp_enqueue_style( 'nutramea-design' );
	wp_add_inline_style( 'nutramea-design', $css );
}
add_action( 'wp_enqueue_scripts', 'nutramea_design_styles', 20 );

/**
 * Registers POST /wp-json/nutramea/v1/subscribe, which the brief form posts to.
 */
function nutramea_register_subscribe_route() {
	register_rest_route(
		'nutramea/v1',
		'/subscribe',
		array(
			'methods'             => 'POST',
			'callback'            => 'nutramea_handle_subscribe',
			'permission_callback' => '__return_true',
			'args'                => array(
				'email' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'nutramea_register_subscribe_route' );

/**
 * Stores one subscriber address and notifies the site admin.
 *
 * @param WP_REST_Request $request Incoming request.
 * @return WP_REST_Response
 */
function nutramea_handle_subscribe( $request ) {
	$email = sanitize_email( (string) $request->get_param( 'email' ) );

	if ( ! is_email( $email ) ) {
		return new WP_REST_Response(
			array(
				'ok'      => false,
				'message' => 'That email address is not valid.',
			),
			400
		);
	}

	// Five attempts per address per hour, so the route cannot be used to flood the list.
	$bucket   = 'nutramea_rate_' . md5( $email );
	$attempts = (int) get_transient( $bucket );

	if ( $attempts >= 5 ) {
		return new WP_REST_Response(
			array(
				'ok'      => false,
				'message' => 'Too many attempts. Try again later.',
			),
			429
		);
	}

	set_transient( $bucket, $attempts + 1, HOUR_IN_SECONDS );

	$list = get_option( 'nutramea_subscribers', array() );

	if ( ! is_array( $list ) ) {
		$list = array();
	}

	if ( count( $list ) >= 20000 ) {
		return new WP_REST_Response(
			array(
				'ok'      => false,
				'message' => 'The list is not accepting new addresses right now.',
			),
			503
		);
	}

	if ( ! isset( $list[ $email ] ) ) {
		$list[ $email ] = current_time( 'mysql' );
		update_option( 'nutramea_subscribers', $list, false );

		wp_mail(
			get_option( 'admin_email' ),
			'New brief subscriber',
			sprintf( "%s subscribed to the weekly brief.\n\nTotal subscribers: %d", $email, count( $list ) )
		);
	}

	return new WP_REST_Response(
		array(
			'ok'      => true,
			'message' => 'Subscribed.',
		),
		200
	);
}

/**
 * Exports the subscriber list as CSV for a logged in administrator.
 *
 * Visit /wp-admin/admin-post.php?action=nutramea_export_subscribers while signed in.
 */
function nutramea_export_subscribers() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Not allowed.', '', array( 'response' => 403 ) );
	}

	$list = get_option( 'nutramea_subscribers', array() );

	if ( ! is_array( $list ) ) {
		$list = array();
	}

	nocache_headers();
	header( 'Content-Type: text/csv; charset=utf-8' );
	header( 'Content-Disposition: attachment; filename=nutramea-subscribers.csv' );

	$out = fopen( 'php://output', 'w' );
	fputcsv( $out, array( 'email', 'subscribed_at' ) );

	foreach ( $list as $email => $when ) {
		fputcsv( $out, array( $email, $when ) );
	}

	fclose( $out );
	exit;
}
add_action( 'admin_post_nutramea_export_subscribers', 'nutramea_export_subscribers' );
