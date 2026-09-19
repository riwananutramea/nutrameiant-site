<?php
/**
 * Minimal WordPress + WooCommerce stubs.
 *
 * Enough of the real API surface to actually EXECUTE the theme integration and
 * assert on what it produces. Linting proves a file parses; it does not prove
 * the markup is right, that the menu logic dedupes, or that a hostile display
 * name is escaped. This does.
 *
 * Each stub mirrors the real function's contract closely enough for those
 * assertions to mean something, and no further.
 *
 * @package NutraMEA\Tests
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'EP_ROOT', 1 );
define( 'EP_PAGES', 4096 );

$GLOBALS['wp_actions_registered'] = array();
$GLOBALS['wp_filters_registered'] = array();
$GLOBALS['wp_shortcodes']         = array();
$GLOBALS['wp_options']            = array();
$GLOBALS['wp_query_vars']         = array();
$GLOBALS['wp_inline_styles']      = array();
$GLOBALS['wp_rewrite_endpoints']  = array();
$GLOBALS['wp_flush_count']        = 0;

/* ------------------------------------------------------------------ hooks */

function add_action( $hook, $callback, $priority = 10, $args = 1 ) {
	$GLOBALS['wp_actions_registered'][ $hook ][] = $callback;
	return true;
}
function add_filter( $hook, $callback, $priority = 10, $args = 1 ) {
	$GLOBALS['wp_filters_registered'][ $hook ][] = $callback;
	return true;
}
function apply_filters( $hook, $value ) {
	$args = array_slice( func_get_args(), 1 );
	foreach ( $GLOBALS['wp_filters_registered'][ $hook ] ?? array() as $callback ) {
		$value      = call_user_func_array( $callback, $args );
		$args[0]    = $value;
	}
	return $value;
}
function do_action( $hook ) {
	$args = array_slice( func_get_args(), 1 );
	foreach ( $GLOBALS['wp_actions_registered'][ $hook ] ?? array() as $callback ) {
		call_user_func_array( $callback, $args );
	}
}
function add_shortcode( $tag, $callback ) {
	$GLOBALS['wp_shortcodes'][ $tag ] = $callback;
}

/* ----------------------------------------------------------- escaping/i18n */

// Deliberately the real behaviour: these are what stop a hostile display name
// becoming markup, so stubbing them as pass-throughs would make the security
// assertions worthless.
function esc_html( $t )  { return htmlspecialchars( (string) $t, ENT_QUOTES, 'UTF-8' ); }
function esc_attr( $t )  { return htmlspecialchars( (string) $t, ENT_QUOTES, 'UTF-8' ); }
function esc_url( $u )   { return htmlspecialchars( (string) $u, ENT_QUOTES, 'UTF-8' ); }
function esc_textarea( $t ) { return esc_html( $t ); }
function wp_kses_post( $t ) { return (string) $t; }
function __( $t, $d = null )          { return $t; }
function esc_html__( $t, $d = null )  { return esc_html( $t ); }
function esc_attr__( $t, $d = null )  { return esc_attr( $t ); }

/* ------------------------------------------------------------------ users */

$GLOBALS['wp_current_user'] = null;

class WP_User {
	public $ID = 0;
	public $display_name = '';
	public $first_name = '';
	public function __construct( $id = 0, $display = '', $first = '' ) {
		$this->ID           = $id;
		$this->display_name = $display;
		$this->first_name   = $first;
	}
}
class WP_Post {
	public $post_content = '';
	public function __construct( $content = '' ) { $this->post_content = $content; }
}

function wp_set_current_user_stub( $user ) { $GLOBALS['wp_current_user'] = $user; }
function is_user_logged_in() { return $GLOBALS['wp_current_user'] instanceof WP_User; }
function wp_get_current_user() { return $GLOBALS['wp_current_user'] ?: new WP_User(); }
function get_current_user_id() { return $GLOBALS['wp_current_user']->ID ?? 0; }
function get_userdata( $id ) { return $GLOBALS['wp_current_user']; }

/* ------------------------------------------------------------------- site */

function get_bloginfo( $what ) { return 'NutraMEA Intelligence'; }
function get_locale() { return 'en_US'; }
function home_url( $path = '/' ) { return 'https://nutrameaint.com' . $path; }
function wp_login_url( $redirect = '' ) { return 'https://nutrameaint.com/login/'; }
function is_ssl() { return true; }
function get_stylesheet_directory_uri() {
	if ( $GLOBALS['wp_explode_on_app_url'] ) {
		throw new RuntimeException( 'simulated theme URI failure' );
	}
	return 'https://nutrameaint.com/wp-content/themes/nutramea-theme';
}
function trailingslashit( $s ) { return rtrim( (string) $s, '/\\' ) . '/'; }
function wp_json_encode( $data ) { return json_encode( $data ); }
// Fixed salt so HMAC-derived room names are reproducible across runs.
function wp_salt( $scheme = 'auth' ) { return 'test-salt-do-not-use-in-production'; }
function sanitize_title( $t ) {
	$t = strtolower( (string) $t );
	$t = preg_replace( '/[^a-z0-9]+/', '-', $t );
	return trim( $t, '-' );
}
function sanitize_text_field( $t ) { return trim( strip_tags( (string) $t ) ); }
function wp_unslash( $v ) { return is_string( $v ) ? stripslashes( $v ) : $v; }

function add_query_arg( $args, $url ) {
	$parts = array();
	foreach ( $args as $k => $v ) { $parts[] = rawurlencode( $k ) . '=' . $v; }
	return $url . '?' . implode( '&', $parts );
}

/* ------------------------------------------------------ request context */

$GLOBALS['wp_is_admin']   = false;
$GLOBALS['wp_doing_ajax'] = false;
$GLOBALS['wp_user_can']   = true;
// Fault injection, so failure paths can be exercised rather than assumed.
$GLOBALS['wp_flush_throws']         = false;
$GLOBALS['wp_explode_on_app_url']   = false;
$GLOBALS['wp_explode_on_menu']      = false;

function is_admin() { return (bool) $GLOBALS['wp_is_admin']; }
function wp_doing_ajax() { return (bool) $GLOBALS['wp_doing_ajax']; }
function wp_doing_cron() { return defined( 'DOING_CRON' ) && DOING_CRON; }
function current_user_can( $cap ) { return (bool) $GLOBALS['wp_user_can']; }

function get_option( $k, $default = false ) { return $GLOBALS['wp_options'][ $k ] ?? $default; }
function update_option( $k, $v, $autoload = null ) { $GLOBALS['wp_options'][ $k ] = $v; return true; }
function flush_rewrite_rules( $hard = true ) {
	$GLOBALS['wp_flush_count']++;
	if ( $GLOBALS['wp_flush_throws'] ) {
		throw new RuntimeException( 'simulated rewrite flush failure' );
	}
}
function add_rewrite_endpoint( $name, $places ) { $GLOBALS['wp_rewrite_endpoints'][] = $name; }

$GLOBALS['wp_rewrite_rules']  = array();
$GLOBALS['wp_redirects']      = array();
$GLOBALS['wp_header_calls']   = 0;
$GLOBALS['wp_footer_calls']   = 0;
$GLOBALS['wp_status_header']  = 0;
$GLOBALS['wp_nocache_called'] = false;

function add_rewrite_rule( $regex, $query, $after = 'bottom' ) {
	$GLOBALS['wp_rewrite_rules'][ $regex ] = $query;
}
function nocache_headers() { $GLOBALS['wp_nocache_called'] = true; }
function status_header( $code ) { $GLOBALS['wp_status_header'] = $code; }
function get_header( $name = null ) { $GLOBALS['wp_header_calls']++; }
function get_footer( $name = null ) { $GLOBALS['wp_footer_calls']++; }
function wp_safe_redirect( $location, $status = 302 ) {
	$GLOBALS['wp_redirects'][] = $location;
	// The real function does not exit; callers do. Signal via exception so the
	// test harness can observe the redirect without killing the process.
	throw new RuntimeException( 'REDIRECT:' . $location );
}

function set_query_var_stub( $k, $v ) { $GLOBALS['wp_query_vars'][ $k ] = $v; }
function get_query_var( $k, $default = '' ) { return $GLOBALS['wp_query_vars'][ $k ] ?? $default; }

/* --------------------------------------------------------------- rendering */

$GLOBALS['wp_current_post'] = null;
function get_post() { return $GLOBALS['wp_current_post']; }
function has_shortcode( $content, $tag ) { return strpos( (string) $content, '[' . $tag ) !== false; }

function wp_register_style( $h, $src, $deps = array(), $ver = null ) { return true; }
function wp_enqueue_style( $h ) { return true; }
function wp_add_inline_style( $h, $css ) { $GLOBALS['wp_inline_styles'][ $h ] = $css; return true; }

$GLOBALS['wp_inline_scripts'] = array();
function wp_register_script( $h, $src, $deps = array(), $ver = null, $footer = false ) { return true; }
function wp_enqueue_script( $h ) { return true; }
function wp_add_inline_script( $h, $js, $pos = 'after' ) {
	$GLOBALS['wp_inline_scripts'][ $h ] = $js;
	return true;
}

/* ------------------------------------------------------------ woocommerce */

$GLOBALS['wc_account_menu'] = array(
	'dashboard'       => 'Dashboard',
	'orders'          => 'Orders',
	'downloads'       => 'Downloads',
	'edit-address'    => 'Addresses',
	'edit-account'    => 'Account details',
	'customer-logout' => 'Log out',
);
$GLOBALS['wc_is_account_page'] = false;

function wc_get_account_menu_items() {
	if ( $GLOBALS['wp_explode_on_menu'] ) {
		throw new RuntimeException( 'simulated account menu failure' );
	}
	return apply_filters( 'woocommerce_account_menu_items', $GLOBALS['wc_account_menu'] );
}
function wc_get_account_endpoint_url( $endpoint ) {
	return 'https://nutrameaint.com/my-account/' . $endpoint . '/';
}
function is_account_page() { return (bool) $GLOBALS['wc_is_account_page']; }
function wc_logout_url() { return 'https://nutrameaint.com/my-account/customer-logout/'; }
