<?php
/**
 * Executes the theme integration against the WordPress stubs and asserts on
 * what it actually produces.
 *
 * Run: php tests/php/integration.test.php
 *
 * @package NutraMEA\Tests
 */

require_once __DIR__ . '/wp-stubs.php';

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
function ok( $cond, $msg = 'assertion failed' ) {
	if ( ! $cond ) { throw new Exception( $msg ); }
}
function eq( $actual, $expected, $msg = '' ) {
	if ( $actual !== $expected ) {
		throw new Exception( ( $msg ? $msg . ': ' : '' ) . 'expected ' . var_export( $expected, true ) . ', got ' . var_export( $actual, true ) );
	}
}
function contains( $haystack, $needle, $msg = '' ) {
	if ( strpos( (string) $haystack, (string) $needle ) === false ) {
		throw new Exception( ( $msg ? $msg . ': ' : '' ) . 'expected to find "' . $needle . '"' );
	}
}
function lacks( $haystack, $needle, $msg = '' ) {
	if ( strpos( (string) $haystack, (string) $needle ) !== false ) {
		throw new Exception( ( $msg ? $msg . ': ' : '' ) . 'did not expect to find "' . $needle . '"' );
	}
}
/** Decodes the base64url `cfg` parameter back into the config array. */
function decode_cfg( $url ) {
	ok( preg_match( '/cfg=([A-Za-z0-9\-_]+)/', $url, $m ), 'no cfg parameter in ' . $url );
	$b64 = strtr( $m[1], '-_', '+/' );
	$b64 .= str_repeat( '=', ( 4 - strlen( $b64 ) % 4 ) % 4 );
	return json_decode( base64_decode( $b64 ), true );
}

echo "NutraMEA WordPress integration\n";

/* ----------------------------------------------------------------- loading */

t( 'the integration file loads without error', function () {
	require_once __DIR__ . '/../../theme/nutramea-meetings.php';
	ok( class_exists( 'NutraMEA_Meetings' ), 'class was not defined' );
} );

t( 'it registers every hook it depends on', function () {
	ok( isset( $GLOBALS['wp_actions_registered']['init'] ), 'init not hooked' );
	ok( isset( $GLOBALS['wp_filters_registered']['query_vars'] ), 'query_vars not hooked' );
	ok( isset( $GLOBALS['wp_filters_registered']['woocommerce_account_menu_items'] ), 'account menu not hooked' );
	ok( isset( $GLOBALS['wp_actions_registered']['woocommerce_account_meetings_endpoint'] ), 'endpoint renderer not hooked' );
	ok( isset( $GLOBALS['wp_actions_registered']['wp_enqueue_scripts'] ), 'assets not hooked' );
	ok( isset( $GLOBALS['wp_shortcodes']['nutramea_meetings'] ), 'shortcode not registered' );
} );

t( 'the rewrite endpoint is registered on init', function () {
	do_action( 'init' );
	ok( in_array( 'meetings', $GLOBALS['wp_rewrite_endpoints'], true ), 'endpoint missing' );
} );

t( 'the front end never flushes rewrite rules', function () {
	// The whole site regenerating its rewrite rules on ordinary page loads is
	// what made sign-in slow enough to look broken. tests/php/auth-safety
	// covers this in depth; this asserts the headline contract.
	$GLOBALS['wp_is_admin'] = false;
	do_action( 'wp_loaded' );
	do_action( 'init' );
	eq( $GLOBALS['wp_flush_count'], 0, 'a front-end request flushed rewrite rules' );
} );

t( 'an administrator registers the permalinks once', function () {
	$GLOBALS['wp_is_admin'] = true;
	do_action( 'admin_init' );
	$after_first = $GLOBALS['wp_flush_count'];
	do_action( 'admin_init' );
	do_action( 'admin_init' );
	eq( $after_first, 1, 'should flush exactly once' );
	eq( $GLOBALS['wp_flush_count'], 1, 'flushed again on later admin requests' );
	$GLOBALS['wp_is_admin'] = false;
} );

/* ------------------------------------------------------------ account menu */

t( 'Meetings is added to the account menu, above Log out', function () {
	$items = wc_get_account_menu_items();
	ok( isset( $items['meetings'] ), 'Meetings missing from the menu' );
	$keys = array_keys( $items );
	ok(
		array_search( 'meetings', $keys, true ) < array_search( 'customer-logout', $keys, true ),
		'Meetings must come before Log out'
	);
	eq( array_key_last( $items ), 'customer-logout', 'Log out must stay last' );
} );

t( 'an existing Meetings entry is never duplicated', function () {
	$app   = NutraMEA_Meetings::instance();
	$items = $app->add_account_menu_item( array(
		'dashboard'       => 'Dashboard',
		'meetings'        => 'Meetings',   // already provided elsewhere
		'customer-logout' => 'Log out',
	) );
	eq( count( array_keys( $items, 'Meetings', true ) ), 1, 'Meetings appears twice' );
	eq( count( $items ), 3, 'menu grew unexpectedly' );
} );

t( 'the menu survives having no logout entry', function () {
	$app   = NutraMEA_Meetings::instance();
	$items = $app->add_account_menu_item( array( 'dashboard' => 'Dashboard' ) );
	ok( isset( $items['meetings'] ), 'Meetings missing' );
} );

/* --------------------------------------------------------------- dashboard */

t( 'the dashboard is empty for a logged-out visitor', function () {
	wp_set_current_user_stub( null );
	eq( NutraMEA_Meetings::instance()->render_dashboard(), '' );
} );

t( 'the dashboard greets the member and features Meetings once', function () {
	wp_set_current_user_stub( new WP_User( 7, 'Riwana Elshawadfi', 'Riwana' ) );
	$html = NutraMEA_Meetings::instance()->render_dashboard();
	contains( $html, 'Hello, Riwana' );
	contains( $html, 'nutramea-dash__feature' );
	contains( $html, 'Start a meeting' );
	eq( substr_count( $html, 'nutramea-dash__cta' ), 1, 'more than one primary action' );
	// Balanced markup — an unclosed div would break the surrounding page.
	eq( substr_count( $html, '<div' ), substr_count( $html, '</div>' ), 'unbalanced divs' );
} );

t( 'the dashboard falls back to display name when no first name is set', function () {
	wp_set_current_user_stub( new WP_User( 8, 'NutraMEA Member', '' ) );
	contains( NutraMEA_Meetings::instance()->render_dashboard(), 'Hello, NutraMEA Member' );
} );

t( 'dashboard links never repeat the featured card or the page itself', function () {
	wp_set_current_user_stub( new WP_User( 7, 'Riwana', 'Riwana' ) );
	$html = NutraMEA_Meetings::instance()->render_dashboard();
	ok( preg_match_all( '/nutramea-dash__link"\s+href="([^"]+)"/', $html, $m ), 'no secondary links rendered' );
	foreach ( $m[1] as $href ) {
		lacks( $href, '/meetings/', 'featured card repeated as a link' );
		lacks( $href, '/dashboard/', 'links back to the page it is on' );
		lacks( $href, 'customer-logout', 'log out duplicated from the nav' );
	}
	contains( $html, 'Orders' );
	contains( $html, 'Account details' );
} );

t( 'a hostile display name cannot inject markup', function () {
	wp_set_current_user_stub( new WP_User( 9, '<img src=x onerror=alert(1)>', '<script>alert(1)</script>' ) );
	$html = NutraMEA_Meetings::instance()->render_dashboard();
	lacks( $html, '<script>', 'script tag survived escaping' );
	lacks( $html, '<img', 'img tag survived escaping' );
	contains( $html, '&lt;script&gt;' );
} );

/* ------------------------------------------------------------ meeting page */

t( 'logged-out visitors get a sign-in gate, not a meeting', function () {
	wp_set_current_user_stub( null );
	$html = NutraMEA_Meetings::instance()->render();
	lacks( $html, '<iframe', 'the app must not load for a signed-out visitor' );
	contains( $html, 'nutramea-meet__gate' );
	contains( $html, 'Sign in' );
} );

t( 'the meeting page embeds the app with the permissions it needs', function () {
	wp_set_current_user_stub( new WP_User( 7, 'Riwana', 'Riwana' ) );
	$html = NutraMEA_Meetings::instance()->render();
	contains( $html, '<iframe' );
	foreach ( array( 'camera', 'microphone', 'display-capture', 'autoplay', 'clipboard-write' ) as $perm ) {
		contains( $html, $perm, "missing $perm permission — the feature will silently fail" );
	}
	contains( $html, 'nutramea-meet/index.html' );
	eq( substr_count( $html, '<iframe' ), 1, 'more than one app frame' );
} );

t( 'the embedded app is told to hide its duplicate branding', function () {
	wp_set_current_user_stub( new WP_User( 7, 'Riwana', 'Riwana' ) );
	$cfg = decode_cfg( NutraMEA_Meetings::instance()->app_url( 7 ) );
	eq( $cfg['embedded'], true, 'embedded flag not passed' );
	eq( $cfg['provider'], 'jitsi' );
	// The URL carries presentation settings only. Anything security-sensitive
	// travels through the inline global instead, because the app's page is a
	// static file anyone can link to with a `cfg` of their choosing.
	ok( ! isset( $cfg['storage'] ), 'storage settings must not travel in the URL' );
} );

t( 'sensitive settings travel through the trusted inline global', function () {
	$GLOBALS['wc_is_account_page'] = true;
	do_action( 'wp_enqueue_scripts' );
	$js = $GLOBALS['wp_inline_scripts']['nutramea-meetings-config'] ?? '';
	contains( $js, 'window.NUTRAMEA_MEET_CONFIG', 'the trusted global was not emitted' );
	contains( $js, 'googleClientId', 'storage settings missing from the trusted channel' );
	$decoded = json_decode( trim( str_replace( array( 'window.NUTRAMEA_MEET_CONFIG =', ';' ), '', $js ) ), true );
	ok( is_array( $decoded ), 'the global is not valid JSON' );
	// Nothing that could bill must ever be switched on by default.
	eq( $decoded['storage']['googleClientId'], '' );
	$GLOBALS['wc_is_account_page'] = false;
} );

t( 'the config filter can repoint the deployment without editing the file', function () {
	add_filter( 'nutramea_meetings_config', function ( $config ) {
		$config['jitsi']['domain']            = 'meet.nutrameaint.com';
		$config['storage']['googleClientId']  = 'abc.apps.googleusercontent.com';
		return $config;
	} );
	$cfg = decode_cfg( NutraMEA_Meetings::instance()->app_url( 7 ) );
	eq( $cfg['jitsi']['domain'], 'meet.nutrameaint.com' );

	// The Google client reaches the app through the trusted global, not the URL.
	$GLOBALS['wc_is_account_page'] = true;
	do_action( 'wp_enqueue_scripts' );
	contains(
		$GLOBALS['wp_inline_scripts']['nutramea-meetings-config'] ?? '',
		'abc.apps.googleusercontent.com',
		'filtered client ID did not reach the trusted channel'
	);
	$GLOBALS['wc_is_account_page'] = false;
} );

/* -------------------------------------------------------------- room names */

t( 'a personal room is stable, private to the member, and URL-safe', function () {
	$app = NutraMEA_Meetings::instance();
	$a1  = $app->personal_room( 7 );
	$a2  = $app->personal_room( 7 );
	$b   = $app->personal_room( 8 );
	eq( $a1, $a2, 'room name changed between calls — invites would break' );
	ok( $a1 !== $b, 'two members share a room' );
	// 20 hex characters is 80 bits of an HMAC keyed on the site's auth salt:
	// stable, URL-safe, and not reachable by guessing member IDs.
	ok( preg_match( '/^room-[a-f0-9]{20}$/', $a1 ), "unexpected shape: $a1" );
	// Adjacent member IDs must not produce adjacent room names.
	eq( strlen( $a1 ), strlen( $b ) );
	ok( levenshtein( $a1, $b ) > 8, 'room names for neighbouring members are too similar' );
	// And it must not be any naive encoding of the ID.
	foreach ( array( 'room-7', 'room-user-7', 'room-00000000000000000007' ) as $naive ) {
		ok( $a1 !== $naive, 'room name is derived from the member ID' );
	}
} );

t( 'an invite link opens the room it names, sanitised', function () {
	set_query_var_stub( 'meeting', 'Board Sync!! <script>' );
	$url = NutraMEA_Meetings::instance()->app_url( 7 );
	ok( preg_match( '/room=([^&]+)/', $url, $m ), 'no room parameter' );
	$room = rawurldecode( $m[1] );
	eq( $room, 'board-sync-script', 'room name not sanitised' );
	set_query_var_stub( 'meeting', '' );
} );

/* ----------------------------------------------------------------- styling */

t( 'styles load on account pages and carry both components', function () {
	$GLOBALS['wc_is_account_page'] = true;
	do_action( 'wp_enqueue_scripts' );
	$css = $GLOBALS['wp_inline_styles']['nutramea-meetings'] ?? '';
	contains( $css, '.nutramea-dash', 'dashboard styles missing' );
	contains( $css, '.nutramea-meet__frame', 'meeting frame styles missing' );
	$GLOBALS['wc_is_account_page'] = false;
} );

/* ------------------------------------------------------- dashboard template */

t( 'the dashboard template renders through the class', function () {
	wp_set_current_user_stub( new WP_User( 7, 'Riwana', 'Riwana' ) );
	ob_start();
	require __DIR__ . '/../../theme/woocommerce/myaccount/dashboard.php';
	$out = ob_get_clean();
	contains( $out, 'Hello, Riwana' );
	// It must REPLACE WooCommerce's greeting, never sit alongside it.
	lacks( $out, 'from your account dashboard' );
	eq( substr_count( $out, 'Hello,' ), 1, 'the member is greeted more than once' );
} );

echo "\n{$GLOBALS['t_pass']} passed, {$GLOBALS['t_fail']} failed\n";
exit( $GLOBALS['t_fail'] > 0 ? 1 : 0 );
