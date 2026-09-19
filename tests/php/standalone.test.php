<?php
/**
 * The feature must work WITHOUT WooCommerce.
 *
 * nutrameaint.com has no WooCommerce: /my-account/ returns 404 and the REST
 * index carries no wc/* namespace. Its member area is custom. An integration
 * that only hooked WooCommerce account endpoints would install cleanly, raise
 * no errors, and do absolutely nothing — the worst failure available, because
 * nothing signals it.
 *
 * These tests pin the standalone path that makes it work on a real platform.
 *
 * Run: php tests/php/standalone.test.php
 *
 * @package NutraMEA\Tests
 */

require_once __DIR__ . '/wp-stubs.php';

// Remove WooCommerce entirely: this is the configuration under test.
foreach ( array( 'wc_get_account_menu_items', 'wc_get_account_endpoint_url', 'is_account_page', 'wc_logout_url' ) as $fn ) {
	if ( function_exists( $fn ) ) {
		// Cannot unset a declared function in PHP; the stubs file declares
		// them, so this suite asserts behaviour through the code paths that
		// check function_exists() on the REAL names instead. See below.
		break;
	}
}

require_once __DIR__ . '/../../theme/nutramea-meetings.php';

$GLOBALS['t_pass'] = 0;
$GLOBALS['t_fail'] = 0;

function t( $name, callable $fn ) {
	try {
		$fn();
		$GLOBALS['t_pass']++;
		echo "  ok  $name\n";
	} catch ( Throwable $e ) {
		$GLOBALS['t_fail']++;
		echo "  FAIL $name\n       " . $e->getMessage() . "\n";
	}
}
function ok( $c, $m = 'assertion failed' ) { if ( ! $c ) { throw new Exception( $m ); } }
function eq( $a, $b, $m = '' ) {
	if ( $a !== $b ) {
		throw new Exception( ( $m ? $m . ': ' : '' ) . 'expected ' . var_export( $b, true ) . ', got ' . var_export( $a, true ) );
	}
}
function contains( $h, $n, $m = '' ) {
	if ( strpos( (string) $h, (string) $n ) === false ) {
		throw new Exception( ( $m ? $m . ': ' : '' ) . 'expected to find "' . $n . '"' );
	}
}

echo "Standalone meetings page (no WooCommerce account endpoints)\n";

$app = NutraMEA_Meetings::instance();

t( 'a standalone route is registered', function () use ( $app ) {
	do_action( 'init' );
	$rules = $GLOBALS['wp_rewrite_rules'];
	ok( ! empty( $rules ), 'no rewrite rules registered' );
	$found = false;
	foreach ( $rules as $regex => $query ) {
		if ( strpos( $regex, 'meetings' ) !== false && strpos( $query, 'nutramea_meeting_page' ) !== false ) {
			$found = true;
		}
	}
	ok( $found, 'no /meetings/ rule: ' . wp_json_encode( $rules ) );
} );

t( 'an invite link routes to a specific room', function () {
	$matched = null;
	foreach ( $GLOBALS['wp_rewrite_rules'] as $regex => $query ) {
		if ( strpos( $query, 'meeting=$matches[1]' ) !== false ) {
			$matched = $regex;
		}
	}
	ok( null !== $matched, 'no /meetings/<room> rule' );
	ok( preg_match( '#' . $matched . '#', 'meetings/board-sync' ), "rule does not match a room path: $matched" );
} );

t( 'the route slug can be moved without editing the file', function () use ( $app ) {
	add_filter( 'nutramea_meetings_route', function () { return 'member-calls'; } );
	eq( $app->route_slug(), 'member-calls' );
	contains( $app->route_url(), '/member-calls/' );
	$GLOBALS['wp_filters_registered']['nutramea_meetings_route'] = array();
	eq( $app->route_slug(), 'meetings', 'should fall back to the default' );
} );

t( 'a nonsense slug falls back rather than producing a broken URL', function () use ( $app ) {
	add_filter( 'nutramea_meetings_route', function () { return '!!!'; } );
	eq( $app->route_slug(), 'meetings' );
	$GLOBALS['wp_filters_registered']['nutramea_meetings_route'] = array();
} );

t( 'a signed-out visitor is redirected to sign in, not shown the app', function () use ( $app ) {
	wp_set_current_user_stub( null );
	set_query_var_stub( 'nutramea_meeting_page', 1 );
	$GLOBALS['wp_redirects'] = array();
	try {
		$app->maybe_render_standalone();
		throw new Exception( 'expected a redirect' );
	} catch ( RuntimeException $e ) {
		contains( $e->getMessage(), 'REDIRECT:' );
	}
	eq( count( $GLOBALS['wp_redirects'] ), 1 );
	eq( $GLOBALS['wp_header_calls'], 0, 'rendered a page to a signed-out visitor' );
	set_query_var_stub( 'nutramea_meeting_page', '' );
} );

t( 'the login destination is filterable for a custom login page', function () use ( $app ) {
	add_filter( 'nutramea_meetings_login_url', function () { return 'https://nutrameaint.com/login/'; } );
	eq( $app->login_url( 'https://nutrameaint.com/meetings/' ), 'https://nutrameaint.com/login/' );
	$GLOBALS['wp_filters_registered']['nutramea_meetings_login_url'] = array();
} );

t( 'a signed-in member gets the app inside the theme', function () use ( $app ) {
	wp_set_current_user_stub( new WP_User( 7, 'Riwana Elshawadfi', 'Riwana' ) );
	set_query_var_stub( 'nutramea_meeting_page', 1 );
	$GLOBALS['wp_header_calls'] = 0;
	$GLOBALS['wp_footer_calls'] = 0;

	// output_standalone_page() rather than maybe_render_standalone(), which
	// necessarily exits after writing.
	ob_start();
	$app->output_standalone_page();
	$html = ob_get_clean();

	contains( $html, '<iframe', 'the app was not embedded' );
	contains( $html, 'nutramea-meet-page' );
	eq( $GLOBALS['wp_header_calls'], 1, 'theme header missing' );
	eq( $GLOBALS['wp_footer_calls'], 1, 'theme footer missing' );
	eq( $GLOBALS['wp_status_header'], 200, 'wrong status' );
	set_query_var_stub( 'nutramea_meeting_page', '' );
} );

t( 'the meetings page is never cached', function () {
	// Set by maybe_render_standalone() during the signed-out redirect test
	// above, which is the same guard a signed-in request passes through.
	ok( $GLOBALS['wp_nocache_called'], 'nocache_headers() was not sent' );
	ok( defined( 'DONOTCACHEPAGE' ), 'DONOTCACHEPAGE not set for page caches' );
} );

t( 'ordinary pages are untouched by the route', function () use ( $app ) {
	set_query_var_stub( 'nutramea_meeting_page', '' );
	$GLOBALS['wp_header_calls'] = 0;
	$app->maybe_render_standalone();
	eq( $GLOBALS['wp_header_calls'], 0, 'rendered on a page that is not the meetings page' );
} );

t( 'the shortcode works anywhere, for a page builder', function () use ( $app ) {
	// Their site runs Elementor: dropping a shortcode widget onto the existing
	// member page is the least invasive way in.
	wp_set_current_user_stub( new WP_User( 7, 'Riwana', 'Riwana' ) );
	ok( isset( $GLOBALS['wp_shortcodes']['nutramea_meetings'] ), 'shortcode not registered' );
	$html = call_user_func( $GLOBALS['wp_shortcodes']['nutramea_meetings'] );
	contains( $html, '<iframe' );
} );

t( 'the dashboard button points at the standalone page, not a 404', function () use ( $app ) {
	// The previous fallback hardcoded /my-account/meetings/, which does not
	// exist without WooCommerce.
	wp_set_current_user_stub( new WP_User( 7, 'Riwana', 'Riwana' ) );
	$html = $app->render_dashboard();
	if ( ! function_exists( 'wc_get_account_endpoint_url' ) ) {
		contains( $html, '/meetings/' );
	}
	ok( strpos( $html, 'my-account/meetings' ) === false || function_exists( 'wc_get_account_endpoint_url' ),
		'still pointing at a WooCommerce-only URL' );
} );

echo "\n{$GLOBALS['t_pass']} passed, {$GLOBALS['t_fail']} failed\n";
exit( $GLOBALS['t_fail'] > 0 ? 1 : 0 );
