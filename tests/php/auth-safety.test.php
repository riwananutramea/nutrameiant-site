<?php
/**
 * Authentication safety.
 *
 * Signing in, signing up and activating an account must work when everything
 * else is broken. A meeting page is never worth risking them.
 *
 * These tests exist because an earlier version of this feature called
 * `flush_rewrite_rules()` from `wp_loaded` — on every request, including
 * wp-login.php — guarded only by an option write. If that write ever failed to
 * stick, the site regenerated every rewrite rule on every request. The symptom
 * is not an error; it is the site becoming slow enough to look broken, with
 * login the first thing to fail.
 *
 * Run: php tests/php/auth-safety.test.php
 *
 * @package NutraMEA\Tests
 */

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
function eq( $a, $b, $msg = '' ) {
	if ( $a !== $b ) {
		throw new Exception( ( $msg ? $msg . ': ' : '' ) . 'expected ' . var_export( $b, true ) . ', got ' . var_export( $a, true ) );
	}
}

/**
 * Each case runs in its own PHP process.
 *
 * The integration file registers its hooks once, at include time, based on the
 * request it sees. Testing "what happens on wp-login.php" therefore has to
 * start from a clean interpreter — otherwise every case after the first would
 * be measuring the first case's decision.
 */
function run_in_request( $script, $code, $constants = array() ) {
	$root   = __DIR__;
	$consts = var_export( $constants, true );
	$php    = <<<PHP
<?php
\$_SERVER['SCRIPT_NAME'] = '/$script';
\$_SERVER['PHP_SELF']    = '/$script';
foreach ( $consts as \$name => \$value ) { define( \$name, \$value ); }
require_once '$root/wp-stubs.php';
require_once '$root/../../theme/nutramea-meetings.php';
$code
PHP;
	$tmp = tempnam( sys_get_temp_dir(), 'nutramea' ) . '.php';
	file_put_contents( $tmp, $php );
	$output = shell_exec( escapeshellcmd( PHP_BINARY ) . ' ' . escapeshellarg( $tmp ) . ' 2>&1' );
	unlink( $tmp );
	return trim( (string) $output );
}

/** Reports which hooks the feature registered in a given request context. */
function hooks_registered( $script, $constants = array() ) {
	$out = run_in_request(
		$script,
		'echo json_encode( array(
			"actions"    => array_keys( $GLOBALS["wp_actions_registered"] ),
			"filters"    => array_keys( $GLOBALS["wp_filters_registered"] ),
			"shortcodes" => array_keys( $GLOBALS["wp_shortcodes"] ),
		) );',
		$constants
	);
	$decoded = json_decode( $out, true );
	if ( null === $decoded ) {
		throw new Exception( 'harness produced no JSON: ' . substr( $out, 0, 300 ) );
	}
	return $decoded;
}

echo "Authentication safety\n";

/* ------------------------------------------------- nothing on auth requests */

foreach ( array( 'wp-login.php', 'wp-signup.php', 'wp-activate.php', 'wp-register.php' ) as $script ) {
	t( "$script registers no hooks at all", function () use ( $script ) {
		$h = hooks_registered( $script );
		eq( $h['actions'], array(), "$script registered actions" );
		eq( $h['filters'], array(), "$script registered filters" );
		eq( $h['shortcodes'], array(), "$script registered shortcodes" );
	} );
}

t( 'cron registers no hooks', function () {
	$h = hooks_registered( 'index.php', array( 'DOING_CRON' => true ) );
	eq( $h['actions'], array() );
} );

t( 'XML-RPC registers no hooks', function () {
	$h = hooks_registered( 'xmlrpc.php', array( 'XMLRPC_REQUEST' => true ) );
	eq( $h['actions'], array() );
} );

t( 'installation registers no hooks', function () {
	$h = hooks_registered( 'index.php', array( 'WP_INSTALLING' => true ) );
	eq( $h['actions'], array() );
} );

t( 'an ordinary page still registers everything it needs', function () {
	$h = hooks_registered( 'index.php' );
	ok( in_array( 'init', $h['actions'], true ), 'init missing' );
	ok( in_array( 'wp_enqueue_scripts', $h['actions'], true ), 'assets missing' );
	ok( in_array( 'admin_init', $h['actions'], true ), 'rewrite registration missing' );
	ok( in_array( 'woocommerce_account_menu_items', $h['filters'], true ), 'menu missing' );
	ok( in_array( 'nutramea_meetings', $h['shortcodes'], true ), 'shortcode missing' );
} );

/* ------------------------------------------------- rewrite flushing is safe */

t( 'rewrite rules are never flushed on a front-end request', function () {
	$out = run_in_request(
		'index.php',
		'$GLOBALS["wp_is_admin"] = false;
		 NutraMEA_Meetings::instance()->maybe_flush_rewrites();
		 do_action( "wp_loaded" );
		 do_action( "init" );
		 echo (int) $GLOBALS["wp_flush_count"];'
	);
	eq( $out, '0', 'the front end flushed rewrite rules' );
} );

t( 'rewrite rules are never flushed during AJAX', function () {
	$out = run_in_request(
		'admin-ajax.php',
		'$GLOBALS["wp_is_admin"] = true;
		 $GLOBALS["wp_doing_ajax"] = true;
		 NutraMEA_Meetings::instance()->maybe_flush_rewrites();
		 echo (int) $GLOBALS["wp_flush_count"];'
	);
	eq( $out, '0', 'AJAX flushed rewrite rules' );
} );

t( 'a member without admin rights cannot trigger a flush', function () {
	$out = run_in_request(
		'index.php',
		'$GLOBALS["wp_is_admin"] = true;
		 $GLOBALS["wp_user_can"] = false;
		 NutraMEA_Meetings::instance()->maybe_flush_rewrites();
		 echo (int) $GLOBALS["wp_flush_count"];'
	);
	eq( $out, '0', 'a non-admin flushed rewrite rules' );
} );

t( 'an administrator flushes exactly once, then never again', function () {
	$out = run_in_request(
		'index.php',
		'$GLOBALS["wp_is_admin"] = true;
		 $app = NutraMEA_Meetings::instance();
		 for ( $i = 0; $i < 25; $i++ ) { $app->maybe_flush_rewrites(); }
		 echo (int) $GLOBALS["wp_flush_count"];'
	);
	eq( $out, '1', 'flushed the wrong number of times' );
} );

t( 'a failing flush cannot become a flush-on-every-request loop', function () {
	// The exact failure that made this dangerous before: the guard has to be
	// written BEFORE the flush, so a throwing flush still closes the gate.
	$out = run_in_request(
		'index.php',
		'$GLOBALS["wp_is_admin"] = true;
		 $GLOBALS["wp_flush_throws"] = true;
		 $app = NutraMEA_Meetings::instance();
		 for ( $i = 0; $i < 5; $i++ ) { try { $app->maybe_flush_rewrites(); } catch ( Throwable $e ) {} }
		 echo (int) $GLOBALS["wp_flush_count"];'
	);
	eq( $out, '1', 'a failing flush retried on later requests' );
} );

/* ----------------------------------------------------- rendering is fail-safe */

t( 'a broken meeting page does not take the account page down', function () {
	$out = run_in_request(
		'index.php',
		'wp_set_current_user_stub( new WP_User( 5, "Member", "Member" ) );
		 $GLOBALS["wp_explode_on_app_url"] = true;
		 $html = NutraMEA_Meetings::instance()->render();
		 echo ( strpos( $html, "temporarily unavailable" ) !== false ) ? "degraded" : "unexpected: " . substr( $html, 0, 80 );'
	);
	eq( $out, 'degraded', 'render() did not degrade safely' );
} );

t( 'a broken dashboard still greets the member', function () {
	$out = run_in_request(
		'index.php',
		'wp_set_current_user_stub( new WP_User( 5, "Riwana", "Riwana" ) );
		 $GLOBALS["wp_explode_on_menu"] = true;
		 $html = NutraMEA_Meetings::instance()->render_dashboard();
		 echo ( strpos( $html, "Hello, Riwana" ) !== false ) ? "greeted" : "unexpected: " . substr( $html, 0, 80 );'
	);
	eq( $out, 'greeted', 'dashboard did not degrade safely' );
} );

echo "\n{$GLOBALS['t_pass']} passed, {$GLOBALS['t_fail']} failed\n";
exit( $GLOBALS['t_fail'] > 0 ? 1 : 0 );
